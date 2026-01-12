// src/routes/thread.js
// Phase C.5: Thread Read Canon
import { Router } from "express";
import { readThreadGraph } from "../infrastructure/graph/readThreadGraph.js";
import { assembleThread } from "../domain/feed/Projection.js";
import { captureError, logNearMiss } from "../sentry.js";

const router = Router();

/**
 * GET /api/thread/:id
 * Read-only Thread view
 *
 * Returns a thread (root assertion + all responses) in chronological order.
 * Uses existing assembleThread projection logic.
 */
router.get("/thread/:id", async (req, res) => {
  const viewerId = req.user?.id ?? null;
  const rootId = req.params.id;

  if (!rootId) {
    return res.status(400).json({ error: "Thread ID required" });
  }

  try {
    // 1. Read graph slice for this thread
    const graph = await readThreadGraph(rootId);

    if (graph.nodes.length === 0) {
      return res.status(404).json({ error: "Thread not found" });
    }

    // 2. Project into thread items using existing assembleThread logic
    const items = assembleThread(graph, rootId, { viewerId });

    if (items.length === 0) {
      return res.status(404).json({ error: "Thread not found or not visible" });
    }

    // 3. Identify root and responses
    const root = items.find((item) => item.assertionId === rootId) || items[0];
    const responses = items.filter((item) => item.assertionId !== rootId);

    // Near-miss monitoring: Root exists but unexpectedly empty responses when graph had multiple nodes
    if (graph.nodes.length > 1 && responses.length === 0) {
      logNearMiss("thread-empty-responses", {
        route: "/thread/:id",
        userId: viewerId,
        assertionId: rootId,
        graphNodeCount: graph.nodes.length,
        message: "Thread has graph nodes but no responses after projection",
      });
    }

    return res.status(200).json({
      root,
      responses,
      count: items.length,
    });
  } catch (err) {
    console.error("Thread read error:", err);
    captureError(err, {
      route: "/thread/:id",
      operation: "thread-read",
      userId: viewerId,
      assertionId: rootId,
    });
    return res.status(500).json({ error: "Failed to load thread" });
  }
});

export default router;
