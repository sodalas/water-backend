/**
 * OutboxPersistence.js
 *
 * Phase E.3: Notification Outbox Persistence Layer
 *
 * Manages delivery artifacts in the outbox table.
 * Ensures at-least-once delivery with retry capability.
 *
 * Invariants:
 * - Outbox entries are DELIVERY ARTIFACTS, not semantic truth
 * - One entry per notification per adapter
 * - Retry with exponential backoff
 */

import { pool } from "../../db.js";
import { randomBytes } from "crypto";

/**
 * Generates a unique outbox entry ID
 */
function generateOutboxId() {
  return `outbox_${randomBytes(16).toString("hex")}`;
}

/**
 * Enqueues a notification for delivery via a specific adapter.
 *
 * @param {Object} params
 * @param {string} params.notificationId - The notification to deliver
 * @param {string} params.adapter - 'websocket' or 'push'
 * @returns {Promise<{enqueued: boolean, id: string|null}>}
 */
export async function enqueueDelivery({ notificationId, adapter }) {
  const id = generateOutboxId();

  const result = await pool.query(
    `
    INSERT INTO notification_outbox (id, notification_id, adapter)
    VALUES ($1, $2, $3)
    ON CONFLICT (notification_id, adapter) DO NOTHING
    RETURNING id
    `,
    [id, notificationId, adapter]
  );

  return {
    enqueued: result.rowCount > 0,
    id: result.rows[0]?.id || null,
  };
}

/**
 * Fetches pending deliveries for a specific adapter.
 *
 * @param {string} adapter - 'websocket' or 'push'
 * @param {number} limit - Max entries to fetch
 * @returns {Promise<Array>}
 */
export async function getPendingDeliveries(adapter, limit = 100) {
  const result = await pool.query(
    `
    SELECT
      o.id,
      o.notification_id,
      o.adapter,
      o.attempts,
      o.next_attempt_at,
      n.recipient_id,
      n.actor_id,
      n.assertion_id,
      n.notification_type,
      n.reaction_type,
      n.created_at as notification_created_at
    FROM notification_outbox o
    JOIN notifications n ON o.notification_id = n.id
    WHERE o.adapter = $1
      AND o.status = 'pending'
      AND o.next_attempt_at <= NOW()
    ORDER BY o.next_attempt_at ASC
    LIMIT $2
    `,
    [adapter, limit]
  );

  return result.rows.map(mapOutboxRow);
}

/**
 * Marks a delivery as successful.
 *
 * @param {string} outboxId - The outbox entry ID
 * @returns {Promise<{updated: boolean}>}
 */
export async function markDelivered(outboxId) {
  const result = await pool.query(
    `
    UPDATE notification_outbox
    SET status = 'delivered',
        delivered_at = NOW(),
        attempts = attempts + 1
    WHERE id = $1 AND status = 'pending'
    `,
    [outboxId]
  );

  return { updated: result.rowCount > 0 };
}

/**
 * Marks a delivery as failed with retry scheduling.
 *
 * @param {string} outboxId - The outbox entry ID
 * @param {string} error - Error message
 * @param {boolean} retryable - Whether to retry
 * @returns {Promise<{updated: boolean}>}
 */
export async function markFailed(outboxId, error, retryable = true) {
  const MAX_ATTEMPTS = 5;

  if (retryable) {
    // Exponential backoff: 1min, 2min, 4min, 8min, 16min
    const result = await pool.query(
      `
      UPDATE notification_outbox
      SET attempts = attempts + 1,
          last_error = $2,
          next_attempt_at = NOW() + (INTERVAL '1 minute' * POWER(2, attempts)),
          status = CASE
            WHEN attempts + 1 >= $3 THEN 'failed'
            ELSE 'pending'
          END
      WHERE id = $1 AND status = 'pending'
      `,
      [outboxId, error, MAX_ATTEMPTS]
    );

    return { updated: result.rowCount > 0 };
  } else {
    // Non-retryable: mark as failed immediately
    const result = await pool.query(
      `
      UPDATE notification_outbox
      SET status = 'failed',
          attempts = attempts + 1,
          last_error = $2
      WHERE id = $1 AND status = 'pending'
      `,
      [outboxId, error]
    );

    return { updated: result.rowCount > 0 };
  }
}

/**
 * Gets delivery status for a notification.
 *
 * @param {string} notificationId - The notification ID
 * @returns {Promise<Array>}
 */
export async function getDeliveryStatus(notificationId) {
  const result = await pool.query(
    `
    SELECT id, adapter, status, attempts, last_error, delivered_at
    FROM notification_outbox
    WHERE notification_id = $1
    `,
    [notificationId]
  );

  return result.rows;
}

/**
 * Deletes old delivered entries for cleanup.
 *
 * @param {number} olderThanDays - Delete entries older than this
 * @returns {Promise<{deleted: number}>}
 */
export async function cleanupDeliveredEntries(olderThanDays = 7) {
  const result = await pool.query(
    `
    DELETE FROM notification_outbox
    WHERE status = 'delivered'
      AND delivered_at < NOW() - INTERVAL '1 day' * $1
    `,
    [olderThanDays]
  );

  return { deleted: result.rowCount };
}

/**
 * Deletes old failed entries for cleanup.
 *
 * @param {number} olderThanDays - Delete entries older than this
 * @returns {Promise<{deleted: number}>}
 */
export async function cleanupFailedEntries(olderThanDays = 30) {
  const result = await pool.query(
    `
    DELETE FROM notification_outbox
    WHERE status = 'failed'
      AND created_at < NOW() - INTERVAL '1 day' * $1
    `,
    [olderThanDays]
  );

  return { deleted: result.rowCount };
}

/**
 * Maps database row to outbox object
 */
function mapOutboxRow(row) {
  return {
    id: row.id,
    notificationId: row.notification_id,
    adapter: row.adapter,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    recipientId: row.recipient_id,
    payload: {
      type: row.notification_type,
      actorId: row.actor_id,
      assertionId: row.assertion_id,
      reactionType: row.reaction_type,
      createdAt: row.notification_created_at,
    },
  };
}

/**
 * Gets total count of pending outbox entries across all adapters.
 * Used for near-miss monitoring of delivery backlog.
 *
 * @returns {Promise<number>} Total pending delivery count
 */
export async function getOutboxDepth() {
  const result = await pool.query(`
    SELECT COUNT(*) as depth
    FROM notification_outbox
    WHERE status = 'pending'
  `);

  return parseInt(result.rows[0]?.depth || 0, 10);
}
