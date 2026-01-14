// domain/feed/Projection.js
import { VISIBILITY } from "../composer/CSO.js";
import { EDGES, NODES } from "../graph/Model.js";
import { logNearMiss } from "../../sentry.js";

// Extended Edge Types (Read-Side Awareness)
const EDGE_SUPERSEDES = "SUPERSEDES";

// Phase D.0: Environment detection for assertion behavior
const IS_DEV = process.env.NODE_ENV !== 'production';
const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Phase: Reaction Aggregation
 * Aggregates reaction counts for an assertion from REACTED_TO edges.
 * Per CONTRACTS.md §3.2: May aggregate for display, must not infer importance.
 * @param {string} assertionId - The assertion to aggregate for
 * @param {Array} edges - All edges in the graph
 * @returns {{ like: number, acknowledge: number }}
 */
function aggregateReactionCounts(assertionId, edges) {
  const counts = { like: 0, acknowledge: 0 };
  for (const edge of edges) {
    if (edge.type === EDGES.REACTED_TO && edge.target === assertionId) {
      const type = edge.reactionType;
      if (type === 'like') counts.like++;
      else if (type === 'acknowledge') counts.acknowledge++;
    }
  }
  return counts;
}

/**
 * Phase D.0 Contract Assertion: Feed Root Purity
 * Asserts that every item in the feed is a thread root, not a response.
 * Logs loudly in development, throws in test mode.
 * @param {Array} feed - The assembled feed items
 * @throws {Error} In test mode if any item is a response
 */
function assertFeedRootPurity(feed) {
  const violations = feed.filter(item => item.assertionType === 'response');

  if (violations.length > 0) {
    const violationIds = violations.map(v => v.assertionId).join(', ');
    const message = `[FEED ROOT PURITY VIOLATION] ${violations.length} response(s) found in feed: ${violationIds}`;

    if (IS_TEST) {
      throw new Error(message);
    }

    if (IS_DEV) {
      console.error('========================================');
      console.error(message);
      console.error('Feed promotes threads, never replies.');
      console.error('Violation details:', violations.map(v => ({
        assertionId: v.assertionId,
        assertionType: v.assertionType,
        text: v.text?.substring(0, 50) + '...',
      })));
      console.error('========================================');
    }

    // Production near-miss logging (Phase F.0)
    logNearMiss("feed-root-purity-violation", {
      violationCount: violations.length,
      violationIds: violations.slice(0, 10).map(v => v.assertionId),
    });
  }
}

/**
 * Projects a raw Node to a Feed Item (Derived View).
 * Phase: Reaction Aggregation - includes reactionCounts from REACTED_TO edges.
 * @param {Object} node - The assertion node
 * @param {Object} author - The author identity
 * @param {Array} edges - All edges in the graph (for reaction aggregation)
 */
function toFeedItem(node, author, edges = []) {
  return {
    assertionId: node.id,
    author: author, // explicit object
    assertionType: node.assertionType,
    text: node.text || "",
    media: node.media || [],
    createdAt: node.createdAt,
    visibility: node.visibility,
    reactionCounts: aggregateReactionCounts(node.id, edges),
  };
}

/**
 * Resolves the "Effective Head" set of assertions.
 * Filters out any node that is the TARGET of a SUPERSEDES edge.
 * Phase B3.4-A: Also filters out tombstones (deleted assertions)
 *
 * Edge semantics: new_version -[:SUPERSEDES]-> old_version
 * "v2 SUPERSEDES v1" = { source: v2, target: v1 }
 * Therefore, the TARGET is the superseded (old) version.
 */
function resolveVersions(nodes, edges) {
  const supersededIds = new Set(
    edges.filter((e) => e.type === EDGE_SUPERSEDES).map((e) => e.target)
  );
  return nodes.filter((n) => {
    // Exclude superseded nodes
    if (supersededIds.has(n.id)) return false;
    // Exclude tombstones (Canon B delete semantics)
    if (n.assertionType === 'tombstone') return false;
    return true;
  });
}

/**
 * Determines visibility for a viewer.
 */
function isVisible(node, authorId, viewerId) {
  if (node.visibility === VISIBILITY.PUBLIC) return true;
  if (node.visibility === VISIBILITY.PRIVATE) return authorId === viewerId;

  // Unlisted/Followers: Default to non-visible if strict relationship unknown
  // For this phase: treat as Private unless owner.
  if (
    node.visibility === VISIBILITY.UNLISTED ||
    node.visibility === VISIBILITY.FOLLOWERS
  ) {
    return authorId === viewerId;
  }
  return false;
}

/**
 * Helper: Get Author ID for an assertion from edges.
 */
function getAuthorId(nodeId, edges) {
  const edge = edges.find(
    (e) => e.type === EDGES.AUTHORED_BY && e.source === nodeId
  );
  return edge ? edge.target : null;
}

/**
 * Assemble Home Feed.
 * Chronological, Visible, Latest-Versions.
 * @param {Object} graph - { nodes: [], edges: [] }
 * @param {Object} context - { viewerId }
 */
export function assembleHome(graph, context) {
  const { nodes, edges } = graph;
  const { viewerId } = context;

  // 1. Resolve Versions
  const heads = resolveVersions(nodes, edges);

  // 2. Build Identity Lookup
  const identityById = new Map();
  nodes
    .filter((n) => n.type === NODES.IDENTITY)
    .forEach((n) => {
      identityById.set(n.id, {
        id: n.id,
        handle: n.handle || null,
        displayName: n.displayName || null,
      });
    });

  function getResolvedAuthor(nodeId) {
    const authorId = getAuthorId(nodeId, edges);
    if (!authorId) return { id: "unknown" }; // Should not happen in strict graph
    return identityById.get(authorId) || { id: authorId };
  }

  // 3. Filter Visibility & Map
  const feed = heads
    .map((node) => {
      // Guard: Is this a potential root?
      // Phase C.5.2 Fix: Use authoritative node property for root detection
      // Previously relied on edge presence which fails when edges are incomplete

      // Primary check: Use assertionType property (source of truth)
      if (node.assertionType === 'response') return null;

      // Secondary check: Edge-based fallback (defensive, belt-and-suspenders)
      const hasOutgoingRespondsTo = edges.some(
        (e) => e.type === EDGES.RESPONDS_TO && e.source === node.id
      );
      if (hasOutgoingRespondsTo) return null;

      const authorId = getAuthorId(node.id, edges);
      if (!isVisible(node, authorId, viewerId)) return null;

      const author = getResolvedAuthor(node.id);
      const item = toFeedItem(node, author, edges);

      // 4. Attach Direct Responses (Derived, not persisted)
      // Phase B3: Apply version resolution to responses
      const responseEdges = edges.filter(
        (e) => e.type === EDGES.RESPONDS_TO && e.target === node.id
      );

      if (responseEdges.length > 0) {
        // Get all response nodes
        const responseNodes = responseEdges
          .map((edge) => nodes.find((n) => n.id === edge.source))
          .filter((n) => n !== null);

        // Phase B3.4-C: Resolve versions for responses (scoped correctly)
        // ✅ Operates on response node set only (responseNodes)
        // ✅ Edges include SUPERSEDES edges relevant to these responses
        // ✅ Does not resolve globally then subset
        const headResponses = resolveVersions(responseNodes, edges);

        const responses = headResponses
          .map((rNode) => {
            const rAuthorId = getAuthorId(rNode.id, edges);
            // Visibility check for response? Assuming same rules.
            if (!isVisible(rNode, rAuthorId, viewerId)) return null;

            const rAuthor = getResolvedAuthor(rNode.id);
            return toFeedItem(rNode, rAuthor, edges);
          })
          .filter((r) => r !== null)
          // Sort responses by oldest first (chronological thread order)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        if (responses.length > 0) {
          item.responses = responses;
        }
      }

      return item;
    })
    .filter((item) => item !== null)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Newest First

  // Phase D.0 Contract Assertion: Verify feed root purity
  assertFeedRootPurity(feed);

  return feed;
}

/**
 * Assemble Profile Feed.
 * Authored by Target, Visible, Latest.
 */
export function assembleProfile(graph, targetIdentityId, context) {
  const { nodes, edges } = graph;
  const { viewerId } = context;

  const heads = resolveVersions(nodes, edges);

  const identityById = new Map();
  nodes
    .filter((n) => n.type === NODES.IDENTITY)
    .forEach((n) => {
      identityById.set(n.id, {
        id: n.id,
        handle: n.handle || null,
        displayName: n.displayName || null,
      });
    });

  return heads
    .filter((node) => {
      const authorId = getAuthorId(node.id, edges);
      return authorId === targetIdentityId;
    })
    .map((node) => {
      const authorId = getAuthorId(node.id, edges);
      if (!isVisible(node, authorId, viewerId)) return null;

      const author = identityById.get(authorId) || { id: authorId };
      return toFeedItem(node, author, edges);
    })
    .filter((item) => item !== null)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Assemble Thread Feed.
 * Root + Tree of Responses.
 */
export function assembleThread(graph, rootId, context) {
  const { nodes, edges } = graph;
  const { viewerId } = context;

  // 1. Traverse Downwards (BFS) to find all nodes in thread
  const threadNodeIds = new Set([rootId]);
  const queue = [rootId];

  while (queue.length > 0) {
    const current = queue.shift();
    // Find responses: Edges where Source responds to Current (Target)
    const responses = edges
      .filter((e) => e.type === EDGES.RESPONDS_TO && e.target === current)
      .map((e) => e.source);

    for (const rId of responses) {
      if (!threadNodeIds.has(rId)) {
        threadNodeIds.add(rId);
        queue.push(rId);
      }
    }
  }

  // 2. Extract strict thread nodes (Exact versions)
  const threadNodes = nodes.filter((n) => threadNodeIds.has(n.id));

  // Phase B3.1: Apply version resolution to thread nodes (filter out superseded)
  const headThreadNodes = resolveVersions(threadNodes, edges);

  const identityById = new Map();
  nodes
    .filter((n) => n.type === NODES.IDENTITY)
    .forEach((n) => {
      identityById.set(n.id, {
        id: n.id,
        handle: n.handle || null,
        displayName: n.displayName || null,
      });
    });

  // 3. Map & Vis check
  const items = headThreadNodes
    .map((node) => {
      const authorId = getAuthorId(node.id, edges);
      if (!isVisible(node, authorId, viewerId)) return null;

      const author = identityById.get(authorId) || { id: authorId };
      const item = toFeedItem(node, author, edges);
      // Enrich with parent pointer for Thread UX
      const parentEdge = edges.find(
        (e) => e.type === EDGES.RESPONDS_TO && e.source === node.id
      );
      if (parentEdge) item.replyTo = parentEdge.target;

      return item;
    })
    .filter((i) => i !== null);

  // 4. Sort: Chronological (Oldest First) for threads
  return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}
