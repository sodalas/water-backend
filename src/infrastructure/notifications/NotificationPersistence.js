/**
 * NotificationPersistence.js
 *
 * Phase E.2: Notification Persistence Layer
 *
 * Handles all database operations for notifications.
 *
 * Invariants:
 * - Notifications are DELIVERY ARTIFACTS, not authoritative data
 * - Can be deleted at any time without affecting system correctness
 * - Idempotent creation via ON CONFLICT constraint
 */

import { pool } from "../../db.js";
import { randomBytes } from "crypto";

/**
 * Generates a unique notification ID
 */
function generateNotificationId() {
  return `notif_${randomBytes(16).toString("hex")}`;
}

/**
 * Creates a notification (idempotent via ON CONFLICT)
 *
 * @param {Object} notification - Notification data
 * @param {string} notification.recipientId - User who receives the notification
 * @param {string} notification.actorId - User who triggered the notification
 * @param {string} notification.assertionId - The assertion involved
 * @param {string} notification.notificationType - 'reply' or 'reaction'
 * @param {string|null} notification.reactionType - 'like' or 'acknowledge' (for reaction notifications)
 * @returns {Promise<{created: boolean, id: string|null}>}
 */
export async function createNotification({
  recipientId,
  actorId,
  assertionId,
  notificationType,
  reactionType = null,
}) {
  const id = generateNotificationId();

  const result = await pool.query(
    `
    INSERT INTO notifications (
      id, recipient_id, actor_id, assertion_id, notification_type, reaction_type
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (actor_id, assertion_id, notification_type, COALESCE(reaction_type, '')) DO NOTHING
    RETURNING id
    `,
    [id, recipientId, actorId, assertionId, notificationType, reactionType]
  );

  return {
    created: result.rowCount > 0,
    id: result.rows[0]?.id || null,
  };
}

/**
 * Fetches notifications for a user with cursor-based pagination
 *
 * @param {string} userId - Recipient user ID
 * @param {Object} options - Pagination options
 * @param {number} options.limit - Max notifications to return
 * @param {string|null} options.cursorCreatedAt - Created_at timestamp cursor
 * @param {string|null} options.cursorId - ID cursor for tie-breaking
 * @returns {Promise<{items: Array, nextCursor: string|null}>}
 */
export async function getNotificationsForUser(
  userId,
  { limit = 20, cursorCreatedAt = null, cursorId = null } = {}
) {
  // Fetch one extra to determine if there are more
  const fetchLimit = limit + 1;

  let query;
  let params;

  if (cursorCreatedAt && cursorId) {
    // Cursor pagination: get items older than cursor
    query = `
      SELECT
        n.id,
        n.recipient_id,
        n.actor_id,
        n.assertion_id,
        n.notification_type,
        n.reaction_type,
        n.read,
        n.created_at,
        n.read_at,
        u.id as actor_user_id,
        u.name as actor_name,
        u.handle as actor_handle
      FROM notifications n
      LEFT JOIN "user" u ON n.actor_id = u.id
      WHERE n.recipient_id = $1
        AND (n.created_at, n.id) < ($2::timestamptz, $3)
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $4
    `;
    params = [userId, cursorCreatedAt, cursorId, fetchLimit];
  } else {
    // No cursor: get newest
    query = `
      SELECT
        n.id,
        n.recipient_id,
        n.actor_id,
        n.assertion_id,
        n.notification_type,
        n.reaction_type,
        n.read,
        n.created_at,
        n.read_at,
        u.id as actor_user_id,
        u.name as actor_name,
        u.handle as actor_handle
      FROM notifications n
      LEFT JOIN "user" u ON n.actor_id = u.id
      WHERE n.recipient_id = $1
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $2
    `;
    params = [userId, fetchLimit];
  }

  const result = await pool.query(query, params);

  // Check if there are more items
  const hasMore = result.rows.length > limit;
  const items = hasMore ? result.rows.slice(0, limit) : result.rows;

  // Build next cursor from last item
  let nextCursor = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
  }

  return {
    items: items.map(mapNotificationRow),
    nextCursor,
  };
}

/**
 * Marks a notification as read
 *
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<{updated: boolean}>}
 */
export async function markNotificationRead(notificationId, userId) {
  const result = await pool.query(
    `
    UPDATE notifications
    SET read = TRUE, read_at = NOW()
    WHERE id = $1 AND recipient_id = $2 AND NOT read
    `,
    [notificationId, userId]
  );

  return { updated: result.rowCount > 0 };
}

/**
 * Marks all notifications as read for a user
 *
 * @param {string} userId - User ID
 * @returns {Promise<{count: number}>}
 */
export async function markAllNotificationsRead(userId) {
  const result = await pool.query(
    `
    UPDATE notifications
    SET read = TRUE, read_at = NOW()
    WHERE recipient_id = $1 AND NOT read
    `,
    [userId]
  );

  return { count: result.rowCount };
}

/**
 * Gets unread notification count for a user
 *
 * @param {string} userId - User ID
 * @returns {Promise<number>}
 */
export async function getUnreadCount(userId) {
  const result = await pool.query(
    `
    SELECT COUNT(*) as count
    FROM notifications
    WHERE recipient_id = $1 AND NOT read
    `,
    [userId]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Deletes old notifications (for cleanup jobs)
 *
 * @param {number} olderThanDays - Delete notifications older than this many days
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldNotifications(olderThanDays = 90) {
  const result = await pool.query(
    `
    DELETE FROM notifications
    WHERE created_at < NOW() - INTERVAL '1 day' * $1
    `,
    [olderThanDays]
  );

  return { deleted: result.rowCount };
}

// --- Helper functions ---

/**
 * Encodes cursor for pagination
 */
function encodeCursor(createdAt, id) {
  const data = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

/**
 * Decodes cursor for pagination
 */
export function decodeCursor(cursor) {
  if (!cursor) return { cursorCreatedAt: null, cursorId: null };

  try {
    const data = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
    return {
      cursorCreatedAt: data.createdAt,
      cursorId: data.id,
    };
  } catch {
    return { cursorCreatedAt: null, cursorId: null };
  }
}

/**
 * Maps a database row to notification object
 */
function mapNotificationRow(row) {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    assertionId: row.assertion_id,
    notificationType: row.notification_type,
    reactionType: row.reaction_type,
    read: row.read,
    createdAt: row.created_at,
    readAt: row.read_at,
    actor: row.actor_user_id
      ? {
          id: row.actor_user_id,
          name: row.actor_name,
          handle: row.actor_handle,
        }
      : null,
  };
}
