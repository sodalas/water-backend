// src/services/IdempotencyReconciler.js
// Phase F.1: Idempotency reconciliation for stale pending records
//
// When a publish request crashes after Neo4j write but before Postgres completion,
// the pending record remains orphaned. This reconciler attempts safe recovery.
//
// Safe-by-default rules (from directive):
// 1. Fresh records (< TTL): do nothing, return null
// 2. Stale records (>= TTL): attempt Neo4j confirmation if assertionId available
// 3. Never "complete" without Neo4j confirmation
// 4. If confirmation fails: keep pending, caller handles with Conflict error

import { pool } from "../db.js";
import { getGraphAdapter } from "../infrastructure/graph/getGraphAdapter.js";
import { completeIdempotency } from "../infrastructure/idempotency/PublishIdempotency.js";
import { captureError, addBreadcrumb } from "../sentry.js";

/**
 * Staleness threshold in milliseconds.
 * Records older than this are considered stale and eligible for reconciliation.
 * 5 minutes is long enough for legitimate in-flight requests to complete.
 */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Attempt to reconcile a stale pending idempotency record.
 *
 * Rules:
 * 1. If pending record is fresh (< TTL), do nothing - return null
 * 2. If stale (>= TTL), attempt to confirm whether assertion exists in Neo4j
 * 3. If confirmation succeeds: mark complete with confirmed assertionId
 * 4. If confirmation fails: return null (caller will throw Conflict)
 *
 * Guardrail: Never "complete" without Neo4j confirmation.
 *
 * @param {string} idempotencyKey - Client-provided unique key
 * @param {string} userId - User ID for scoping
 * @returns {Promise<{ assertionId: string, createdAt: Date } | null>}
 *   Returns reconciled record if successful, null otherwise
 */
export async function reconcilePending(idempotencyKey, userId) {
  addBreadcrumb("idempotency", "Attempting reconciliation", {
    idempotencyKey,
    userId,
  });

  try {
    // Fetch the pending record with full details
    const pendingRecord = await getPendingRecord(idempotencyKey, userId);

    if (!pendingRecord) {
      // No pending record found - nothing to reconcile
      return null;
    }

    // Check staleness
    const ageMs = Date.now() - pendingRecord.createdAt.getTime();
    if (ageMs < STALE_THRESHOLD_MS) {
      console.info("[RECONCILER] Record is fresh, skipping reconciliation:", {
        idempotencyKey,
        userId,
        ageMs,
        threshold: STALE_THRESHOLD_MS,
      });
      // Fresh record: let it complete naturally or retry later
      return null;
    }

    console.info("[RECONCILER] Record is stale, attempting recovery:", {
      idempotencyKey,
      userId,
      ageMs,
      threshold: STALE_THRESHOLD_MS,
    });

    // Attempt Neo4j confirmation
    // Currently, we cannot deterministically find the assertion without the assertionId
    // being stored in Neo4j (e.g., via idempotencyKey property).
    //
    // Future enhancement: Store idempotencyKey in Neo4j assertion properties,
    // then query by it here.
    //
    // For now, if the pending record has no assertionId (normal case for crash),
    // we cannot auto-recover. Return null and let caller handle with Conflict.

    // Check if there's any recoverable state
    // This would be enhanced once we have deterministic lookup capability
    const confirmed = await attemptNeo4jConfirmation(idempotencyKey, userId, pendingRecord);

    if (!confirmed) {
      console.warn("[RECONCILER] Cannot confirm assertion in Neo4j:", {
        idempotencyKey,
        userId,
        message: "No deterministic lookup available. Manual intervention may be required.",
      });
      return null;
    }

    // Confirmed: complete the idempotency record
    await completeIdempotency(idempotencyKey, userId, confirmed.assertionId);

    console.info("[RECONCILER] Successfully reconciled pending record:", {
      idempotencyKey,
      userId,
      assertionId: confirmed.assertionId,
    });

    return {
      assertionId: confirmed.assertionId,
      createdAt: pendingRecord.createdAt,
    };
  } catch (error) {
    console.error("[RECONCILER] Reconciliation error:", error);
    captureError(error, {
      operation: "idempotency-reconcile",
      idempotencyKey,
      userId,
    });
    return null;
  }
}

/**
 * Fetch pending record directly (bypassing status filter in main getter).
 *
 * @param {string} idempotencyKey
 * @param {string} userId
 * @returns {Promise<{ createdAt: Date, assertionId: string | null } | null>}
 */
async function getPendingRecord(idempotencyKey, userId) {
  const result = await pool.query(
    `
    SELECT created_at, assertion_id
    FROM publish_idempotency
    WHERE idempotency_key = $1
      AND user_id = $2
      AND status = 'pending'
      AND expires_at > NOW()
    `,
    [idempotencyKey, userId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    createdAt: result.rows[0].created_at,
    assertionId: result.rows[0].assertion_id,
  };
}

/**
 * Attempt to confirm the assertion exists in Neo4j.
 *
 * Currently limited: without storing idempotencyKey in Neo4j, we cannot
 * deterministically find assertions created by crashed requests.
 *
 * Future enhancement possibilities:
 * 1. Store idempotencyKey in assertion properties
 * 2. Use deterministic assertionId generation (hash of idempotencyKey + userId)
 * 3. Store clientId and query by it
 *
 * @param {string} idempotencyKey
 * @param {string} userId
 * @param {{ assertionId: string | null }} pendingRecord
 * @returns {Promise<{ assertionId: string } | null>}
 */
async function attemptNeo4jConfirmation(idempotencyKey, userId, pendingRecord) {
  // Edge case: if somehow the pending record has an assertionId
  // (e.g., partial update succeeded), verify it exists in Neo4j
  if (pendingRecord.assertionId) {
    const graph = getGraphAdapter();
    const assertion = await graph.getAssertionForRevision(pendingRecord.assertionId);

    if (assertion && assertion.authorId === userId) {
      return { assertionId: pendingRecord.assertionId };
    }
  }

  // No assertionId and no deterministic lookup strategy available
  // Cannot auto-recover
  return null;
}

/**
 * Check if a pending record is stale (eligible for reconciliation).
 * Exported for testing.
 *
 * @param {Date} createdAt - When the record was created
 * @param {number} [thresholdMs=STALE_THRESHOLD_MS] - Staleness threshold
 * @returns {boolean}
 */
export function isRecordStale(createdAt, thresholdMs = STALE_THRESHOLD_MS) {
  const ageMs = Date.now() - createdAt.getTime();
  return ageMs >= thresholdMs;
}

/**
 * Get the staleness threshold (for testing).
 * @returns {number}
 */
export function getStaleThresholdMs() {
  return STALE_THRESHOLD_MS;
}
