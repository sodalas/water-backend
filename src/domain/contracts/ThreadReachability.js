// domain/contracts/ThreadReachability.js
// Phase D.0: Thread Reachability Assertion for dev/test

import { EDGES } from "../graph/Model.js";

/**
 * Phase D.0 Contract Assertion: Thread Reachability
 *
 * Asserts that a reply is reachable from its thread root via RESPONDS_TO edges.
 * This is a test/dev utility to verify graph integrity after reply creation.
 *
 * @param {Object} graph - { nodes: [], edges: [] }
 * @param {string} replyId - The ID of the reply to check
 * @param {string} expectedRootId - The expected thread root ID
 * @returns {{ reachable: boolean, path: string[], error?: string }}
 */
export function assertThreadReachability(graph, replyId, expectedRootId) {
  const { nodes, edges } = graph;

  // Find the reply node
  const replyNode = nodes.find(n => n.id === replyId);
  if (!replyNode) {
    return {
      reachable: false,
      path: [],
      error: `Reply node not found: ${replyId}`,
    };
  }

  // BFS upward via RESPONDS_TO edges to find root
  const visited = new Set();
  const queue = [{ id: replyId, path: [replyId] }];

  while (queue.length > 0) {
    const { id: currentId, path } = queue.shift();

    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Check if we've reached the expected root
    if (currentId === expectedRootId) {
      return {
        reachable: true,
        path: path.reverse(), // Return path from root to reply
      };
    }

    // Find parent via RESPONDS_TO edge (edge.source === currentId)
    const parentEdges = edges.filter(
      e => e.type === EDGES.RESPONDS_TO && e.source === currentId
    );

    for (const edge of parentEdges) {
      if (!visited.has(edge.target)) {
        queue.push({
          id: edge.target,
          path: [...path, edge.target],
        });
      }
    }
  }

  // Could not reach root
  return {
    reachable: false,
    path: Array.from(visited),
    error: `Reply ${replyId} is not reachable from root ${expectedRootId}. Visited: ${Array.from(visited).join(' -> ')}`,
  };
}

/**
 * Test utility: Assert reachability and throw if not reachable
 * @param {Object} graph - { nodes: [], edges: [] }
 * @param {string} replyId - The ID of the reply to check
 * @param {string} expectedRootId - The expected thread root ID
 * @throws {Error} If reply is not reachable from root
 */
export function expectThreadReachable(graph, replyId, expectedRootId) {
  const result = assertThreadReachability(graph, replyId, expectedRootId);
  if (!result.reachable) {
    throw new Error(
      `[THREAD REACHABILITY VIOLATION] ${result.error}\n` +
      `Invariant: All visible replies must be reachable from their thread root.`
    );
  }
  return result;
}

/**
 * Test utility: Assert all replies in a thread are reachable from root
 * @param {Object} graph - { nodes: [], edges: [] }
 * @param {string} rootId - The thread root ID
 * @throws {Error} If any reply is orphaned
 */
export function expectAllRepliesReachable(graph, rootId) {
  const { nodes, edges } = graph;

  // Find all nodes that are responses (have assertionType === 'response')
  const responses = nodes.filter(n => n.assertionType === 'response');

  const orphaned = [];
  for (const response of responses) {
    const result = assertThreadReachability(graph, response.id, rootId);
    if (!result.reachable) {
      orphaned.push({
        id: response.id,
        error: result.error,
      });
    }
  }

  if (orphaned.length > 0) {
    throw new Error(
      `[THREAD REACHABILITY VIOLATION] ${orphaned.length} orphaned replies found:\n` +
      orphaned.map(o => `  - ${o.id}: ${o.error}`).join('\n') +
      `\nInvariant: All visible replies must be reachable from their thread root.`
    );
  }
}
