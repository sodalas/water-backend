// domain/feed/Projection.js
import { VISIBILITY } from "../composer/CSO.js";
import { EDGES, NODES } from "../graph/Model.js";

// Extended Edge Types (Read-Side Awareness)
const EDGE_SUPERSEDES = "SUPERSEDES";

/**
 * Projects a raw Node to a Feed Item (Derived View).
 */
function toFeedItem(node, author) {
  return {
    assertionId: node.id,
    author: author, // explicit object
    assertionType: node.assertionType,
    text: node.text || "",
    media: node.media || [],
    createdAt: node.createdAt,
    visibility: node.visibility,
  };
}

/**
 * Resolves the "Effective Head" set of assertions.
 * Filters out any node that is the SOURCE of a SUPERSEDES edge.
 */
function resolveVersions(nodes, edges) {
  const supersededIds = new Set(
    edges.filter((e) => e.type === EDGE_SUPERSEDES).map((e) => e.source)
  );
  return nodes.filter((n) => !supersededIds.has(n.id));
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
      // Phase III correction: Root selection excludes responses.
      // If node has an outgoing RESPONDS_TO edge, it is a Response, not a Root.
      const isResponse = edges.some(
        (e) => e.type === EDGES.RESPONDS_TO && e.source === node.id
      );
      if (isResponse) return null;

      const authorId = getAuthorId(node.id, edges);
      if (!isVisible(node, authorId, viewerId)) return null;

      const author = getResolvedAuthor(node.id);
      const item = toFeedItem(node, author);

      // 4. Attach Direct Responses (Derived, not persisted)
      const responseEdges = edges.filter(
        (e) => e.type === EDGES.RESPONDS_TO && e.target === node.id
      );

      if (responseEdges.length > 0) {
        const responses = responseEdges
          .map((edge) => {
            const rNode = nodes.find((n) => n.id === edge.source);
            if (!rNode) return null;

            const rAuthorId = getAuthorId(rNode.id, edges);
            // Visibility check for response? Assuming same rules.
            if (!isVisible(rNode, rAuthorId, viewerId)) return null;

            const rAuthor = getResolvedAuthor(rNode.id);
            return toFeedItem(rNode, rAuthor);
          })
          .filter((r) => r !== null)
          // Sort responses by oldest first (chronological thread order) or newest?
          // "The Home feed shows roots, with responses attached".
          // Usually threads are chronological.
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        if (responses.length > 0) {
          item.responses = responses;
        }
      }

      return item;
    })
    .filter((item) => item !== null)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Newest First

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
      return toFeedItem(node, author);
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
  const items = threadNodes
    .map((node) => {
      const authorId = getAuthorId(node.id, edges);
      if (!isVisible(node, authorId, viewerId)) return null;

      const author = identityById.get(authorId) || { id: authorId };
      const item = toFeedItem(node, author);
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
