// src/routes/home.js
import { Router } from "express";
import { readHomeGraph } from "../infrastructure/graph/readHomeGraph.js";
import { assembleHome } from "../domain/feed/Projection.js";
import { captureError, logNearMiss } from "../sentry.js";

const router = Router();

/**
 * GET /api/home
 * Read-only Home feed
 */
/**
 * GET /api/home
 * Read-only Home feed
 */
router.get("/home", async (req, res) => {
  const viewerId = req.user?.id ?? null;
  const { cursor } = req.query;

  try {
    const { cursorCreatedAt, cursorId } = decodeCursor(cursor);

    // 1. Read graph slice
    const graph = await readHomeGraph({ 
      limit: 20,
      cursorCreatedAt, 
      cursorId 
    });

    // 2. Project into Home feed items
    const items = assembleHome(graph, { viewerId });

    // 3. Compute next cursor
    let nextCursor = null;
    if (items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        createdAt: lastItem.createdAt,
        assertionId: lastItem.assertionId
      });
    }

    return res.status(200).json({ items, nextCursor });
  } catch (err) {
    console.error("Home feed error:", err);
    captureError(err, {
      route: "/home",
      operation: "home-feed",
      userId: viewerId,
      cursor: cursor || "none",
    });
    return res.status(500).json({ error: "Failed to load home feed" });
  }
});

// Cursor Helpers
function encodeCursor(data) {
  if (!data) return null;
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function decodeCursor(cursor) {
  if (!cursor) return { cursorCreatedAt: null, cursorId: null };
  try {
    const json = Buffer.from(cursor, "base64").toString("utf-8");
    const { createdAt, assertionId } = JSON.parse(json);
    return { cursorCreatedAt: createdAt, cursorId: assertionId };
  } catch (e) {
    console.warn("Invalid cursor format", cursor);
    return { cursorCreatedAt: null, cursorId: null };
  }
}

export default router;
