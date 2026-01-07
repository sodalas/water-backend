// src/infrastructure/graph/Neo4jGraphAdapter.js
import neo4j from "neo4j-driver";
import { NODES, EDGES } from "../../domain/graph/Model.js";
import { ASSERTION_TYPES } from "../../domain/composer/CSO.js";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Neo4j write-side adapter for Water's graph model.
 *
 * Key invariants (from Model.js docs):
 * - Assertion authored by Identity (AUTHORED_BY)
 * - Response assertions have exactly one RESPONDS_TO edge
 */
export class Neo4jGraphAdapter {
  /**
   * @param {{ uri: string, user: string, password: string }} cfg
   */
  constructor(cfg) {
    const { uri, user, password } = cfg;
    if (!uri || !user || !password) {
      throw new Error("Neo4jGraphAdapter misconfigured (missing NEO4J_URI/USER/PASSWORD)");
    }
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async close() {
    await this.driver.close();
  }

  /**
   * Persist a CSO as an Assertion node + edges.
   *
   * @param {{
   *   viewer: { id: string, handle?: string, displayName?: string },
   *   cso: any,
   *   clientId?: string
   * }} input
   * @returns {Promise<{ assertionId: string, createdAt: string }>}
   */
  async publish(input) {
    const { viewer, cso } = input;
    const createdAt = cso?.meta?.createdAt || nowIso();
    const assertionId = cryptoRandomId("asrt");

    const session = this.driver.session({ defaultAccessMode: neo4j.session.WRITE });

    // Normalize CSO fields (keep it permissive; domain validation already ran)
    const assertionProps = {
      id: assertionId,
      assertionType: cso.assertionType,
      text: typeof cso.text === "string" ? cso.text : "",
      createdAt,
      visibility: cso.visibility,
      media: Array.isArray(cso.media) ? JSON.stringify(cso.media) : "[]",
      originPublicationId: typeof cso.originPublicationId === "string" ? cso.originPublicationId : null,
      title: typeof cso.title === "string" ? cso.title : null,
    };

    const viewerProps = {
      id: viewer.id,
      handle: viewer.handle ?? null,
      displayName: viewer.displayName ?? null,
    };

    // For RESPONSE: we treat refs[0].uri as target assertion id (strict tree: exactly 1 parent)
    const isResponse = cso.assertionType === ASSERTION_TYPES.RESPONSE;
    const responseTarget =
      isResponse && Array.isArray(cso.refs) && cso.refs.length > 0
        ? extractAssertionIdFromRef(cso.refs[0])
        : null;

    const topics = Array.isArray(cso.topics) ? cso.topics.filter(Boolean) : [];
    const mentions = Array.isArray(cso.mentions) ? cso.mentions.filter(Boolean) : [];

    try {
      await session.executeWrite(async (tx) => {
        // 1) Identity
        await tx.run(
          `
          MERGE (u:${NODES.IDENTITY} {id: $userId})
          ON CREATE SET u.handle = $handle, u.displayName = $displayName
          ON MATCH  SET u.handle = coalesce($handle, u.handle),
                     u.displayName = coalesce($displayName, u.displayName)
          `,
          {
            userId: viewerProps.id,
            handle: viewerProps.handle,
            displayName: viewerProps.displayName,
          }
        );

        // 2) Assertion node
        await tx.run(
          `
          CREATE (a:${NODES.ASSERTION} $props)
          `,
          { props: assertionProps }
        );

        // 3) AUTHORED_BY edge
        await tx.run(
          `
          MATCH (a:${NODES.ASSERTION} {id: $assertionId})
          MATCH (u:${NODES.IDENTITY} {id: $userId})
          MERGE (a)-[:${EDGES.AUTHORED_BY}]->(u)
          `,
          { assertionId, userId: viewerProps.id }
        );

        // 4) RESPONDS_TO (strict: exactly one) if response
        if (responseTarget) {
          await tx.run(
            `
            MATCH (a:${NODES.ASSERTION} {id: $assertionId})
            MATCH (p:${NODES.ASSERTION} {id: $parentId})
            MERGE (a)-[:${EDGES.RESPONDS_TO}]->(p)
            `,
            { assertionId, parentId: responseTarget }
          );
        }

        // 5) TAGGED_WITH for topics (Topic id = string)
        for (const t of topics) {
          await tx.run(
            `
            MERGE (topic:${NODES.TOPIC} {id: $topicId})
            WITH topic
            MATCH (a:${NODES.ASSERTION} {id: $assertionId})
            MERGE (a)-[:${EDGES.TAGGED_WITH}]->(topic)
            `,
            { assertionId, topicId: String(t) }
          );
        }

        // 6) MENTIONS for identities (Identity id = string)
        for (const m of mentions) {
          await tx.run(
            `
            MERGE (who:${NODES.IDENTITY} {id: $mentionId})
            WITH who
            MATCH (a:${NODES.ASSERTION} {id: $assertionId})
            MERGE (a)-[:${EDGES.MENTIONS}]->(who)
            `,
            { assertionId, mentionId: String(m) }
          );
        }
      });

      return { assertionId, createdAt };
    } finally {
      await session.close();
    }
  }

  /**
   * Read graph slice for Home feed
   *
   * Fetches recent assertions with:
   * - Author identity
   * - Topics (tags)
   * - Mentions
   * - Responses
   *
   * @param {{ limit?: number, cursorCreatedAt?: string, cursorId?: string }} params
   * @returns {Promise<{ nodes: Array, edges: Array }>}
   */
  async readHomeGraph({ limit = 20, cursorCreatedAt, cursorId }) {
    const session = this.driver.session();

    try {
      const result = await session.run(
        `
        MATCH (a:${NODES.ASSERTION})-[:${EDGES.AUTHORED_BY}]->(u:${NODES.IDENTITY})
        WHERE NOT (a)-[:${EDGES.RESPONDS_TO}]->()
        AND (
          $cursorCreatedAt IS NULL
          OR a.createdAt < $cursorCreatedAt
          OR (a.createdAt = $cursorCreatedAt AND a.id < $cursorId)
        )
        OPTIONAL MATCH (a)-[:${EDGES.TAGGED_WITH}]->(t:${NODES.TOPIC})
        OPTIONAL MATCH (a)-[:${EDGES.MENTIONS}]->(m:${NODES.IDENTITY})
        OPTIONAL MATCH (r:${NODES.ASSERTION})-[:${EDGES.RESPONDS_TO}]->(a)
        OPTIONAL MATCH (r)-[:${EDGES.AUTHORED_BY}]->(ru:${NODES.IDENTITY})
        RETURN a, u, collect(distinct t) as topics, collect(distinct m) as mentions, collect(distinct { r: r, ru: ru }) as responses
        ORDER BY a.createdAt DESC, a.id DESC
        LIMIT $limit
        `,
        { limit: neo4j.int(limit), cursorCreatedAt, cursorId }
      );

      return this._mapGraphSliceResults(result.records);
    } finally {
      await session.close();
    }
  }

  /**
   * Map Neo4j result records to graph slice format
   * @private
   */
  _mapGraphSliceResults(records) {
    const nodes = [];
    const edges = [];

    for (const row of records) {
      const a = row.get("a");
      const u = row.get("u");
      const topics = row.get("topics");
      const mentions = row.get("mentions");
      const responses = row.get("responses");

      // Assertion node
      nodes.push({
        id: a.properties.id,
        type: NODES.ASSERTION,
        ...this._parseProps(a.properties),
      });

      // Author identity
      nodes.push({
        id: u.properties.id,
        type: NODES.IDENTITY,
        ...u.properties,
      });

      edges.push({
        type: EDGES.AUTHORED_BY,
        source: a.properties.id,
        target: u.properties.id,
      });

      // Topics
      for (const t of topics) {
        if (!t) continue;
        nodes.push({
          id: t.properties.id,
          type: NODES.TOPIC,
          ...t.properties,
        });
        edges.push({
          type: EDGES.TAGGED_WITH,
          source: a.properties.id,
          target: t.properties.id,
        });
      }

      // Mentions
      for (const m of mentions) {
        if (!m) continue;
        nodes.push({
          id: m.properties.id,
          type: NODES.IDENTITY,
          ...m.properties,
        });
        edges.push({
          type: EDGES.MENTIONS,
          source: a.properties.id,
          target: m.properties.id,
        });
      }

      // Responses
      for (const resp of responses) {
        const r = resp?.r ?? resp?.get?.('r');
        const ru = resp?.ru ?? resp?.get?.('ru');

        if (!r || !ru) continue;

        nodes.push({
          id: r.properties.id,
          type: NODES.ASSERTION,
          ...this._parseProps(r.properties),
        });

        nodes.push({
          id: ru.properties.id,
          type: NODES.IDENTITY,
          ...ru.properties,
        });

        edges.push({
          type: EDGES.AUTHORED_BY,
          source: r.properties.id,
          target: ru.properties.id,
        });

        edges.push({
          type: EDGES.RESPONDS_TO,
          source: r.properties.id,
          target: a.properties.id,
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Parse assertion properties, handling JSON media field
   * @private
   */
  _parseProps(props) {
    const p = { ...props };
    if (typeof p.media === "string") {
      try {
        p.media = JSON.parse(p.media);
      } catch (e) {
        console.warn("Failed to parse media JSON", e);
        p.media = [];
      }
    }

    // Invariant Enforcement: Media must ALWAYS be an array
    if (!Array.isArray(p.media)) {
      p.media = [];
    }

    return p;
  }
}

function extractAssertionIdFromRef(ref) {
  // You can tighten this later once ref shapes stabilize.
  // For now: allow { uri: "assertion:<id>" } or { uri: "<id>" }
  const uri = typeof ref?.uri === "string" ? ref.uri : null;
  if (!uri) return null;
  if (uri.startsWith("assertion:")) return uri.slice("assertion:".length);
  return uri;
}

function cryptoRandomId(prefix) {
  // Node 18+ has global crypto; if not, fall back.
  const r =
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  return `${prefix}_${r}`;
}
