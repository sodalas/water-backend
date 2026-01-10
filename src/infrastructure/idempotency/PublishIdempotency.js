import { pool } from '../../db.js';

/**
 * Check if idempotency key exists and return associated assertion
 * Backend Correctness Sweep: Now handles pending status
 *
 * @param {string} idempotencyKey - Client-provided unique key
 * @param {string} userId - User ID for scoping
 * @returns {Promise<{ assertionId: string, createdAt: Date, status: string } | null>}
 */
export async function getPublishByIdempotencyKey(idempotencyKey, userId) {
  const result = await pool.query(
    `
    SELECT assertion_id, created_at, status
    FROM publish_idempotency
    WHERE idempotency_key = $1
      AND user_id = $2
      AND expires_at > NOW()
    `,
    [idempotencyKey, userId]
  );

  if (result.rowCount === 0) return null;

  return {
    assertionId: result.rows[0].assertion_id,
    createdAt: result.rows[0].created_at,
    status: result.rows[0].status,
  };
}

/**
 * Create pending idempotency record BEFORE Neo4j write
 * Backend Correctness Sweep: Prevents duplicate publishes on crash
 *
 * @param {string} idempotencyKey - Client-provided unique key
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
export async function createPendingIdempotency(idempotencyKey, userId) {
  await pool.query(
    `
    INSERT INTO publish_idempotency (
      idempotency_key,
      user_id,
      assertion_id,
      status,
      created_at,
      expires_at
    )
    VALUES ($1, $2, NULL, 'pending', NOW(), NOW() + INTERVAL '24 hours')
    ON CONFLICT (idempotency_key, user_id) DO NOTHING
    `,
    [idempotencyKey, userId]
  );
}

/**
 * Complete idempotency record AFTER Neo4j write succeeds
 * Backend Correctness Sweep: Marks publish complete with assertion ID
 *
 * @param {string} idempotencyKey - Client-provided unique key
 * @param {string} userId - User ID
 * @param {string} assertionId - Created assertion ID
 * @returns {Promise<void>}
 */
export async function completeIdempotency(idempotencyKey, userId, assertionId) {
  await pool.query(
    `
    UPDATE publish_idempotency
    SET assertion_id = $3,
        status = 'complete'
    WHERE idempotency_key = $1
      AND user_id = $2
    `,
    [idempotencyKey, userId, assertionId]
  );
}

/**
 * Legacy: Record successful publish with idempotency key
 * DEPRECATED: Use createPendingIdempotency + completeIdempotency instead
 * @param {string} idempotencyKey - Client-provided unique key
 * @param {string} userId - User ID
 * @param {string} assertionId - Created assertion ID
 * @returns {Promise<void>}
 */
export async function recordPublishIdempotency(idempotencyKey, userId, assertionId) {
  await pool.query(
    `
    INSERT INTO publish_idempotency (
      idempotency_key,
      user_id,
      assertion_id,
      status,
      created_at,
      expires_at
    )
    VALUES ($1, $2, $3, 'complete', NOW(), NOW() + INTERVAL '24 hours')
    ON CONFLICT (idempotency_key, user_id) DO NOTHING
    `,
    [idempotencyKey, userId, assertionId]
  );
}

/**
 * Cleanup expired idempotency records
 * Called by scheduled cleanup job
 * @returns {Promise<number>} Number of records deleted
 */
export async function cleanupExpiredIdempotencyKeys() {
  const result = await pool.query(
    `
    DELETE FROM publish_idempotency
    WHERE expires_at <= NOW()
    `
  );

  return result.rowCount;
}
