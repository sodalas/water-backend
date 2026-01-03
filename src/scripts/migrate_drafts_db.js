/**
 * Canonical migration for composer_drafts
 *
 * Invariants (🟥):
 * - This script is the single source of truth for composer_drafts schema
 * - Safe to run multiple times (idempotent)
 * - Never drops data
 * - Converges legacy schemas forward
 */

import { pool } from "../db.js";

async function migrateComposerDrafts() {
  const client = await pool.connect();

  try {
    console.log("[DB] Migrating composer_drafts schema…");

    await client.query("BEGIN");

    // 1. Ensure table exists (minimal legacy-safe shape)
    await client.query(`
      CREATE TABLE IF NOT EXISTS composer_drafts (
        user_id TEXT PRIMARY KEY
      );
    `);

    // 2. Add canonical columns (idempotent)
    await client.query(`
      ALTER TABLE composer_drafts
        ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS client_id TEXT,
        ADD COLUMN IF NOT EXISTS payload JSONB,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    // 3. Legacy migration: `draft` → `payload`
    // Some early schemas stored the draft as JSON in a `draft` column.
    const { rows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'composer_drafts';
    `);

    const columns = rows.map(r => r.column_name);

    if (columns.includes("draft") && columns.includes("payload")) {
      console.log("[DB] Migrating legacy `draft` → `payload`");

      await client.query(`
        UPDATE composer_drafts
        SET payload = draft
        WHERE payload IS NULL;
      `);
    }

    // 4. Enforce NOT NULL on payload once migrated
    await client.query(`
      UPDATE composer_drafts
      SET payload = '{}'::jsonb
      WHERE payload IS NULL;
    `);

    await client.query(`
      ALTER TABLE composer_drafts
        ALTER COLUMN payload SET NOT NULL;
    `);

    // 5. Index for autosave / recovery
    await client.query(`
      CREATE INDEX IF NOT EXISTS composer_drafts_updated_at_idx
      ON composer_drafts (updated_at DESC);
    `);

    await client.query("COMMIT");

    console.log("[DB] composer_drafts schema migration complete ✅");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[DB] composer_drafts migration failed ❌");
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateComposerDrafts();
