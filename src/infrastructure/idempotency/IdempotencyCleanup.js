// src/infrastructure/idempotency/IdempotencyCleanup.js
import { pool } from "../../db.js";
import { startJobRun, completeJobRun, failJobRun } from "../jobs/JobTracking.js";

const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const JOB_NAME = "cleanup_idempotency";

/**
 * Execute cleanup of expired idempotency keys.
 * Policy: Delete where expires_at <= NOW.
 * Safe to run concurrently (idempotent).
 * Temporal Invariant C: Tracked in job_runs for observability
 */
async function runIdempotencyCleanup() {
  let jobRunId = null;
  try {
    jobRunId = await startJobRun(JOB_NAME);

    const result = await pool.query(
      `DELETE FROM publish_idempotency
       WHERE expires_at <= NOW()`
    );

    await completeJobRun(jobRunId, result.rowCount);

    if (result.rowCount > 0) {
      console.log(`[IdempotencyCleanup] Pruned ${result.rowCount} expired idempotency keys.`);
    }
  } catch (error) {
    // Silent failure: do not crash app or block startup
    console.error("[IdempotencyCleanup] Failed to prune idempotency keys:", error.message);

    if (jobRunId !== null) {
      try {
        await failJobRun(jobRunId, error);
      } catch (trackingError) {
        console.error("[IdempotencyCleanup] Failed to record job failure:", trackingError.message);
      }
    }
  }
}

/**
 * Start the background cleanup scheduler.
 * Runs immediately, then every 12 hours.
 * Backend Correctness Sweep: Returns interval handle for graceful shutdown
 * @returns {NodeJS.Timeout} Interval handle for cleanup
 */
export function startIdempotencyCleanupScheduler() {
  // 1. Run immediately (non-blocking)
  runIdempotencyCleanup();

  // 2. Schedule interval and return handle
  const intervalHandle = setInterval(runIdempotencyCleanup, CLEANUP_INTERVAL_MS);

  console.log(`[IdempotencyCleanup] Scheduler started (Interval: ${CLEANUP_INTERVAL_MS}ms).`);

  return intervalHandle;
}
