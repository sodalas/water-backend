// src/infrastructure/draft/DraftCleanup.js
import { pool } from "../../db.js";

const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RETENTION_DAYS = 30;

/**
 * Execute silent cleanup of expired drafts.
 * Policy: Delete where updated_at < NOW - 30 days.
 * Safe to run concurrently (idempotent).
 */
async function runDraftCleanup() {
  try {
    const result = await pool.query(
      `DELETE FROM composer_drafts 
       WHERE updated_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
    );
    if (result.rowCount > 0) {
      console.log(`[DraftCleanup] Pruned ${result.rowCount} expired drafts.`);
    }
  } catch (error) {
    // Silent failure: do not crash app or block startup
    console.error("[DraftCleanup] Failed to prune drafts:", error.message);
  }
}

/**
 * Start the background cleanup scheduler.
 * Runs immediately, then every 12 hours.
 */
export function startDraftCleanupScheduler() {
  // 1. Run immediately (non-blocking)
  runDraftCleanup();

  // 2. Schedule interval
  setInterval(runDraftCleanup, CLEANUP_INTERVAL_MS);
  
  console.log(`[DraftCleanup] Scheduler started (Interval: ${CLEANUP_INTERVAL_MS}ms).`);
}
