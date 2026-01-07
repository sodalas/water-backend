import { Router } from "express";
import { DraftEnvelopeSchemaV1, DRAFT_SCHEMA_VERSION } from "../domain/drafts/schema.js";
import { loadDraftForUser, saveDraftForUser, deleteDraftForUser } from "../infrastructure/draft/DraftPersistence.js";

const router = Router();

// PUT /composer - Upsert Draft
router.put("/composer", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = DraftEnvelopeSchemaV1.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid draft envelope",
      details: parsed.error.format(),
    });
  }

  const { draft, clientId } = parsed.data;

  try {
    const result = await saveDraftForUser(userId, draft, DRAFT_SCHEMA_VERSION, clientId);

    return res.status(200).json({
      schemaVersion: result.schemaVersion,
      draft: result.draft,
      updatedAt: result.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Draft Persistence Error:", error);
    return res.status(500).json({ error: "Internal Persistence Error" });
  }
});

// GET /composer - Fetch Draft
router.get("/composer", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).end();

  try {
    const result = await loadDraftForUser(userId);

    if (!result) return res.status(204).end();

    return res.status(200).json({
      schemaVersion: result.schema_version,
      draft: result.payload,
      updatedAt: result.updated_at,
    });
  } catch (error) {
    console.error("Draft Fetch Error:", error);
    return res.status(500).json({ error: "Internal Fetch Error" });
  }
});

// DELETE /composer - Delete Draft
router.delete("/composer", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).end();

  try {
    await deleteDraftForUser(userId);

    return res.status(204).end();
  } catch (error) {
    console.error("Draft Delete Error:", error);
    return res.status(500).json({ error: "Internal Delete Error" });
  }
});

export default router;
