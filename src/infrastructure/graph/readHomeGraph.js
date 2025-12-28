import { getGraphAdapter } from "./getGraphAdapter.js";
import { NODES, EDGES } from "../../domain/graph/Model.js";
import { int } from "neo4j-driver";

/**
 * Fetch a minimal graph slice for Home feed.
 * - Recent assertions
 * - Author identity
 * - Topics + mentions (optional but cheap)
 */
export async function readHomeGraph({ limit = 20, cursorCreatedAt, cursorId }) {
  const graph = getGraphAdapter();
  const session = graph.driver.session();

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
      { limit: int(limit), cursorCreatedAt, cursorId }
    );

    const nodes = [];
    const edges = [];

    for (const row of result.records) {
      const a = row.get("a");
      const u = row.get("u");
      const topics = row.get("topics");
      const mentions = row.get("mentions");
      const responses = row.get("responses");

      // Assertion node
      nodes.push({
        id: a.properties.id,
        type: NODES.ASSERTION,
        ...a.properties,
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
        // resp is a Map/Object { r, ru }
        // Neo4j driver returns objects for maps? Or checks needed?
        // Usually objects if collecting a map literal.
        // Safe unpacking for map-like structures or objects
        const r = resp?.r ?? resp?.get?.('r');
        const ru = resp?.ru ?? resp?.get?.('ru');

        if (!r || !ru) continue;

        nodes.push({
          id: r.properties.id,
          type: NODES.ASSERTION,
          ...r.properties,
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
  } finally {
    await session.close();
  }
}


