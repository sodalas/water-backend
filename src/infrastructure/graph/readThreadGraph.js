import { getGraphAdapter } from "./getGraphAdapter.js";

/**
 * Phase C.5: Fetch a graph slice for Thread view.
 *
 * Thin delegation wrapper - all logic encapsulated in Neo4jGraphAdapter.
 *
 * @param {string} rootId - The assertion ID to use as thread root
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
export async function readThreadGraph(rootId) {
  const graph = getGraphAdapter();
  return graph.readThreadGraph(rootId);
}
