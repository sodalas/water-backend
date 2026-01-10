import { getGraphAdapter } from "./getGraphAdapter.js";

/**
 * Fetch a minimal graph slice for Home feed.
 *
 * Thin delegation wrapper - all logic encapsulated in Neo4jGraphAdapter.
 *
 * Backend Correctness Sweep: Cursor Assumptions
 * CRITICAL: cursorId MUST be a string assertionId (never numeric)
 * This assumption is relied upon for tiebreaker ordering in pagination.
 * Numeric cursors will break pagination invariants.
 *
 * @param {{ limit?: number, cursorCreatedAt?: string, cursorId?: string }} params
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
export async function readHomeGraph({ limit = 20, cursorCreatedAt, cursorId }) {
  const graph = getGraphAdapter();
  return graph.readHomeGraph({ limit, cursorCreatedAt, cursorId });
}


