// src/routes/home.js
import { Router } from "express";
import { readHomeGraph } from "../infrastructure/graph/readHomeGraph.js";
import { assembleHome } from "../domain/feed/Projection.js";

const router = Router();

/**
 * GET /api/home
 * Read-only Home feed
 */
router.get("/home", async (req, res) => {
  const viewerId = req.user?.id ?? null;

  try {
    // 1. Read graph slice
    const graph = await readHomeGraph({ limit: 20 });

    // 2. Project into Home feed items
    const feed = assembleHome(graph, { viewerId });

    return res.status(200).json(feed);
  } catch (err) {
    console.error("Home feed error:", err);
    return res.status(500).json({ error: "Failed to load home feed" });
  }
});

export default router;
