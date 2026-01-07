// src/routes/publish.js
import { Router } from "express";
import { validate } from "../domain/composer/Validation.js";
import { getGraphAdapter } from "../infrastructure/graph/getGraphAdapter.js";
import { deleteDraftForUser } from "../infrastructure/draft/DraftPersistence.js";

const router = Router();

/**
 * POST /publish
 * Body: { cso: <ComposerStateObject>, clientId?: string, clearDraft?: boolean }
 */
router.post("/publish", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const cso = req.body?.cso;
  const clientId = req.body?.clientId;
  // Default: Retain draft (false), unless explicitly requested to clear (true)
  const clearDraft = req.body?.clearDraft === true;

  const verdict = validate(cso);
  if (!verdict.ok) {
    return res.status(400).json({
      error: "Invalid CSO",
      details: verdict.errors,
      warnings: verdict.warnings,
    });
  }

  try {
    const graph = getGraphAdapter();

    const result = await graph.publish({
      viewer: {
        id: userId,
        // Better Auth user may have name/email; keep optional
        handle: req.user?.email ?? req.user?.name ?? null,
        displayName: req.user?.name ?? null,
      },
      cso,
      clientId,
    });

    // Optional: clear saved draft after successful publish
    if (clearDraft) {
      try {
        await deleteDraftForUser(userId);
      } catch (e) {
        // non-fatal; publishing succeeded
        console.warn("Publish succeeded but draft clear failed:", e);
      }
    }

    return res.status(201).json({
      assertionId: result.assertionId,
      createdAt: result.createdAt,
    });
  } catch (error) {
    console.error("Publish Error:", error);
    return res.status(500).json({ error: "Internal Publish Error" });
  }
});

export default router;
