/**
 * WebSocketAdapter.js
 *
 * Phase E.3: WebSocket Delivery Adapter
 *
 * Implements the DeliveryAdapter interface for WebSocket-based
 * real-time notification delivery.
 *
 * Invariants:
 * - E.3.1: Does not create meaning (just delivers)
 * - E.3.2: At-least-once delivery (client dedupes)
 * - E.3.3: Offline safety (returns failure if not connected)
 * - E.3.4: Observable (all attempts logged)
 */

import { DeliveryAdapter } from "../../domain/notifications/DeliveryAdapter.js";
import { deliverToUser, isUserConnected, getWebSocketServer } from "./WebSocketServer.js";
import { addBreadcrumb } from "../../sentry.js";

/**
 * WebSocket delivery adapter for real-time notifications.
 */
export class WebSocketAdapter extends DeliveryAdapter {
  constructor() {
    super("websocket");
  }

  /**
   * Checks if the WebSocket server is ready.
   *
   * @returns {Promise<boolean>}
   */
  async isReady() {
    return getWebSocketServer() !== null;
  }

  /**
   * Delivers a notification to a recipient via WebSocket.
   *
   * @param {Object} input
   * @param {string} input.notificationId
   * @param {string} input.recipientId
   * @param {Object} input.payload
   * @returns {Promise<{ok: true} | {ok: false, retryable: boolean, error: string}>}
   */
  async deliver({ notificationId, recipientId, payload }) {
    addBreadcrumb("websocket-adapter", "Attempting delivery", {
      notificationId,
      recipientId,
      payloadType: payload.type,
    });

    // Check if user is connected
    if (!isUserConnected(recipientId)) {
      addBreadcrumb("websocket-adapter", "User not connected", {
        notificationId,
        recipientId,
      });

      // Not connected is not an error - just means WebSocket delivery skipped
      // The notification persists and can be fetched via API
      return {
        ok: false,
        retryable: false, // Don't retry - user is offline
        error: "User not connected",
      };
    }

    try {
      const result = deliverToUser(recipientId, {
        notificationId,
        ...payload,
      });

      if (result.delivered) {
        addBreadcrumb("websocket-adapter", "Delivery successful", {
          notificationId,
          recipientId,
          connectionCount: result.connectionCount,
        });

        return { ok: true };
      } else {
        // User was connected but delivery failed (connection dropped?)
        addBreadcrumb("websocket-adapter", "Delivery failed (no active sockets)", {
          notificationId,
          recipientId,
        });

        return {
          ok: false,
          retryable: true, // Retry - connection might be re-established
          error: "Delivery failed - no active sockets",
        };
      }
    } catch (error) {
      addBreadcrumb("websocket-adapter", "Delivery error", {
        notificationId,
        recipientId,
        error: error.message,
      });

      return {
        ok: false,
        retryable: true,
        error: error.message,
      };
    }
  }
}

// Singleton instance
let webSocketAdapter = null;

/**
 * Gets or creates the WebSocket adapter instance.
 *
 * @returns {WebSocketAdapter}
 */
export function getWebSocketAdapter() {
  if (!webSocketAdapter) {
    webSocketAdapter = new WebSocketAdapter();
  }
  return webSocketAdapter;
}
