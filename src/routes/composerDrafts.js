import { Router } from "express";
import { pool } from "../db.js";
import { DraftEnvelopeSchemaV1, DRAFT_SCHEMA_VERSION } from "../domain/drafts/schema.js";

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
    await pool.query(
      `
      insert into composer_drafts (
        user_id,
        schema_version,
        client_id,
        payload,
        updated_at
      )
      values ($1, $2, $3, $4, now())
      on conflict (user_id)
      do update set
        schema_version = excluded.schema_version,
        client_id = excluded.client_id,
        payload = excluded.payload,
        updated_at = now()
      `,
      [
        userId,
        DRAFT_SCHEMA_VERSION,
        clientId,
        JSON.stringify(draft),
      ]
    );

    return res.status(200).json({
      schemaVersion: DRAFT_SCHEMA_VERSION,
      draft,
      updatedAt: new Date().toISOString(),
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
    const result = await pool.query(
      `
      select schema_version, payload, updated_at
      from composer_drafts
      where user_id = $1
      `,
      [userId]
    );

    if (result.rowCount === 0) return res.status(204).end();

    return res.status(200).json({
      schemaVersion: result.rows[0].schema_version,
      draft: result.rows[0].payload,
      updatedAt: result.rows[0].updated_at,
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
    await pool.query(
      `delete from composer_drafts where user_id = $1`,
      [userId]
    );

    return res.status(204).end();
  } catch (error) {
    console.error("Draft Delete Error:", error);
    return res.status(500).json({ error: "Internal Delete Error" });
  }
});

export default router;
