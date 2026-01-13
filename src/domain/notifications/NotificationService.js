/**
 * NotificationService.js
 *
 * Phase E.2/E.3: Notification Generation Logic (Domain Layer)
 *
 * Separates notification generation from persistence and delivery.
 * Enforces all canon invariants for notification creation.
 *
 * Invariants:
 * - E.2.1: Notifications are purely derived (no system truth)
 * - E.2.3: Assertion parity (roots and replies treated equally)
 * - E.2.4: Visibility & permission respect (no notifications for own actions)
 * - E.2.5: Idempotent generation (handled by persistence layer)
 * - E.3.1: Delivery does not create meaning
 * - E.3.2: At-least-once delivery, exactly-once UX
 */

import { createNotification } from "../../infrastructure/notifications/NotificationPersistence.js";
import { getGraphAdapter } from "../../infrastructure/graph/getGraphAdapter.js";
import { addBreadcrumb, logNearMiss } from "../../sentry.js";
import { scheduleDelivery, deliverImmediately } from "./DeliveryService.js";

/**
 * Generate notification for a reply.
 *
 * Guards:
 * - Don't notify if replying to own assertion
 * - Don't notify if parent assertion not found
 *
 * @param {Object} params
 * @param {string} params.actorId - User who created the reply
 * @param {string} params.replyAssertionId - The reply assertion ID
 * @param {string} params.parentAssertionId - The parent assertion ID
 * @returns {Promise<{created: boolean, reason?: string, id?: string}>}
 */
export async function notifyReply({ actorId, replyAssertionId, parentAssertionId }) {
  const graph = getGraphAdapter();

  // Get parent assertion to find its author
  const parent = await graph.getAssertionForRevision(parentAssertionId);

  if (!parent) {
    logNearMiss("notification-parent-not-found", {
      operation: "notify-reply",
      actorId,
      replyAssertionId,
      parentAssertionId,
    });
    return { created: false, reason: "parent_not_found" };
  }

  // Guard: Don't notify self
  if (parent.authorId === actorId) {
    addBreadcrumb("notification", "Skipping self-reply notification", {
      actorId,
      parentAssertionId,
    });
    return { created: false, reason: "self_reply" };
  }

  // Guard: Don't notify for superseded parent (defensive - reply should target current)
  if (parent.supersedesId) {
    logNearMiss("notification-parent-superseded", {
      operation: "notify-reply",
      actorId,
      parentAssertionId,
      supersedesId: parent.supersedesId,
    });
    // Still create notification - superseded assertions are still valid targets
  }

  addBreadcrumb("notification", "Creating reply notification", {
    actorId,
    recipientId: parent.authorId,
    replyAssertionId,
    parentAssertionId,
  });

  const result = await createNotification({
    recipientId: parent.authorId,
    actorId,
    assertionId: replyAssertionId,
    notificationType: "reply",
  });

  if (result.created) {
    addBreadcrumb("notification", "Reply notification created", {
      notificationId: result.id,
    });

    // Phase E.3: Schedule delivery and attempt immediate WebSocket delivery
    const payload = {
      type: "reply",
      actorId,
      assertionId: replyAssertionId,
      reactionType: null,
      createdAt: new Date().toISOString(),
    };

    // Attempt immediate WebSocket delivery (non-blocking)
    deliverImmediately({
      notificationId: result.id,
      recipientId: parent.authorId,
      payload,
    }).catch(() => {
      // Errors already logged in deliverImmediately
    });

    // Schedule for outbox processing (ensures at-least-once delivery)
    scheduleDelivery(result.id).catch(() => {
      // Errors already logged in scheduleDelivery
    });
  }

  return result;
}

/**
 * Generate notification for a reaction.
 *
 * Guards:
 * - Don't notify if reacting to own assertion
 *
 * @param {Object} params
 * @param {string} params.actorId - User who added the reaction
 * @param {string} params.assertionId - The assertion that was reacted to
 * @param {string} params.reactionType - 'like' or 'acknowledge'
 * @param {string} params.assertionAuthorId - Author of the assertion (pre-fetched)
 * @returns {Promise<{created: boolean, reason?: string, id?: string}>}
 */
export async function notifyReaction({ actorId, assertionId, reactionType, assertionAuthorId }) {
  // Guard: Don't notify self
  if (assertionAuthorId === actorId) {
    addBreadcrumb("notification", "Skipping self-reaction notification", {
      actorId,
      assertionId,
      reactionType,
    });
    return { created: false, reason: "self_reaction" };
  }

  addBreadcrumb("notification", "Creating reaction notification", {
    actorId,
    recipientId: assertionAuthorId,
    assertionId,
    reactionType,
  });

  const result = await createNotification({
    recipientId: assertionAuthorId,
    actorId,
    assertionId,
    notificationType: "reaction",
    reactionType,
  });

  if (result.created) {
    addBreadcrumb("notification", "Reaction notification created", {
      notificationId: result.id,
    });

    // Phase E.3: Schedule delivery and attempt immediate WebSocket delivery
    const payload = {
      type: "reaction",
      actorId,
      assertionId,
      reactionType,
      createdAt: new Date().toISOString(),
    };

    // Attempt immediate WebSocket delivery (non-blocking)
    deliverImmediately({
      notificationId: result.id,
      recipientId: assertionAuthorId,
      payload,
    }).catch(() => {
      // Errors already logged in deliverImmediately
    });

    // Schedule for outbox processing (ensures at-least-once delivery)
    scheduleDelivery(result.id).catch(() => {
      // Errors already logged in scheduleDelivery
    });
  }

  return result;
}
