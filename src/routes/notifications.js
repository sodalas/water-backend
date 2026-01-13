// src/routes/notifications.js

/**
 * Phase E.2: Notifications API
 *
 * Provides endpoints for fetching and managing notifications.
 * Notifications are DELIVERY ARTIFACTS - purely derived from graph events.
 *
 * Endpoints:
 * - GET /notifications - List notifications with cursor pagination
 * - POST /notifications/:id/read - Mark a notification as read
 * - POST /notifications/read-all - Mark all notifications as read
 * - GET /notifications/unread-count - Get unread count (for badges)
 */

import { Router } from "express";
import {
  getNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
  decodeCursor,
} from "../infrastructure/notifications/NotificationPersistence.js";
import { captureError, addBreadcrumb } from "../sentry.js";

const router = Router();

/**
 * GET /notifications
 *
 * Fetch notifications for the authenticated user.
 *
 * Query params:
 * - cursor: Optional cursor for pagination (from previous response)
 * - limit: Optional limit (default 20, max 50)
 *
 * Response: {
 *   items: Notification[],
 *   nextCursor: string | null
 * }
 */
router.get("/notifications", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { cursor, limit: limitStr } = req.query;
  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 50);

  addBreadcrumb("notifications", "Fetching notifications", {
    userId,
    cursor: cursor ? "present" : "none",
    limit,
  });

  try {
    const { cursorCreatedAt, cursorId } = decodeCursor(cursor);

    const result = await getNotificationsForUser(userId, {
      limit,
      cursorCreatedAt,
      cursorId,
    });

    return res.status(200).json({
      items: result.items,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    console.error("Notifications Fetch Error:", error);
    captureError(error, {
      route: "/notifications",
      operation: "list",
      userId,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * POST /notifications/:id/read
 *
 * Mark a specific notification as read.
 *
 * Response: { success: true } or { error: "not_found" }
 */
router.post("/notifications/:id/read", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Missing notification id" });
  }

  addBreadcrumb("notifications", "Marking notification read", {
    userId,
    notificationId: id,
  });

  try {
    const result = await markNotificationRead(id, userId);

    if (!result.updated) {
      // Either not found or already read - both are acceptable
      return res.status(200).json({ success: true, alreadyRead: true });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Notification Read Error:", error);
    captureError(error, {
      route: "/notifications/:id/read",
      operation: "mark-read",
      userId,
      notificationId: id,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * POST /notifications/read-all
 *
 * Mark all notifications as read for the authenticated user.
 *
 * Response: { success: true, count: number }
 */
router.post("/notifications/read-all", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  addBreadcrumb("notifications", "Marking all notifications read", {
    userId,
  });

  try {
    const result = await markAllNotificationsRead(userId);

    return res.status(200).json({
      success: true,
      count: result.count,
    });
  } catch (error) {
    console.error("Notification Read All Error:", error);
    captureError(error, {
      route: "/notifications/read-all",
      operation: "mark-all-read",
      userId,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /notifications/unread-count
 *
 * Get the count of unread notifications (for badge display).
 *
 * Response: { count: number }
 */
router.get("/notifications/unread-count", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const count = await getUnreadCount(userId);

    return res.status(200).json({ count });
  } catch (error) {
    console.error("Notification Count Error:", error);
    captureError(error, {
      route: "/notifications/unread-count",
      operation: "get-count",
      userId,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
