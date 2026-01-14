/**
 * DeliveryService.js
 *
 * Phase E.3: Notification Delivery Orchestrator
 *
 * Coordinates notification delivery across multiple adapters.
 * Manages the outbox queue and processes pending deliveries.
 *
 * Invariants:
 * - E.3.1: Delivery does not create meaning
 * - E.3.2: At-least-once delivery, exactly-once UX
 * - E.3.3: Offline safety (notifications persist)
 * - E.3.4: Observability first (all attempts logged)
 */

import {
  enqueueDelivery,
  getPendingDeliveries,
  markDelivered,
  markFailed,
} from "../../infrastructure/notifications/OutboxPersistence.js";
import { getAdapter, getAllAdapters, registerAdapter } from "./DeliveryAdapter.js";
import { getWebSocketAdapter } from "../../infrastructure/notifications/WebSocketAdapter.js";
import { getPushAdapter, isPushAvailable } from "../../infrastructure/notifications/PushAdapter.js";
import { addBreadcrumb, captureError } from "../../sentry.js";

/**
 * Interval handle for the delivery worker
 * @type {NodeJS.Timer|null}
 */
let workerInterval = null;

/**
 * Whether the worker is currently processing
 * @type {boolean}
 */
let isProcessing = false;

/**
 * Initializes the delivery service and registers adapters.
 *
 * Registers:
 * - WebSocket adapter (always)
 * - Push adapter (if Firebase credentials configured)
 */
export async function initDeliveryService() {
  // Register the WebSocket adapter (always available)
  registerAdapter(getWebSocketAdapter());

  // Conditionally register Push adapter if Firebase is configured
  if (isPushAvailable()) {
    const pushAdapter = await getPushAdapter();
    if (pushAdapter) {
      registerAdapter(pushAdapter);
      console.log("[Delivery] Push adapter registered");
    }
  }

  const adapterNames = getAllAdapters().map(a => a.name).join(", ");
  console.log("[Delivery] Service initialized with adapters:", adapterNames);
}

/**
 * Schedules a notification for delivery via all configured adapters.
 *
 * @param {string} notificationId - The notification to deliver
 * @returns {Promise<{enqueued: string[]}>}
 */
export async function scheduleDelivery(notificationId) {
  const adapters = getAllAdapters();
  const enqueued = [];

  for (const adapter of adapters) {
    try {
      const result = await enqueueDelivery({
        notificationId,
        adapter: adapter.name,
      });

      if (result.enqueued) {
        enqueued.push(adapter.name);
        addBreadcrumb("delivery", "Enqueued for delivery", {
          notificationId,
          adapter: adapter.name,
          outboxId: result.id,
        });
      }
    } catch (error) {
      console.error(`[Delivery] Failed to enqueue for ${adapter.name}:`, error);
      captureError(error, {
        component: "DeliveryService",
        operation: "scheduleDelivery",
        notificationId,
        adapter: adapter.name,
      });
    }
  }

  return { enqueued };
}

/**
 * Immediately attempts to deliver a notification via WebSocket.
 * This is an optimization for real-time delivery.
 *
 * @param {Object} params
 * @param {string} params.notificationId
 * @param {string} params.recipientId
 * @param {Object} params.payload
 * @returns {Promise<{delivered: boolean}>}
 */
export async function deliverImmediately({ notificationId, recipientId, payload }) {
  const wsAdapter = getAdapter("websocket");

  if (!wsAdapter) {
    return { delivered: false };
  }

  try {
    const result = await wsAdapter.deliver({
      notificationId,
      recipientId,
      payload,
    });

    return { delivered: result.ok };
  } catch (error) {
    console.error("[Delivery] Immediate delivery failed:", error);
    captureError(error, {
      component: "DeliveryService",
      operation: "deliverImmediately",
      notificationId,
      recipientId,
    });
    return { delivered: false };
  }
}

/**
 * Processes pending deliveries for a specific adapter.
 *
 * @param {string} adapterName
 * @param {number} batchSize
 * @returns {Promise<{processed: number, delivered: number, failed: number}>}
 */
export async function processOutbox(adapterName, batchSize = 50) {
  const adapter = getAdapter(adapterName);

  if (!adapter) {
    console.warn(`[Delivery] Adapter not found: ${adapterName}`);
    return { processed: 0, delivered: 0, failed: 0 };
  }

  if (!(await adapter.isReady())) {
    addBreadcrumb("delivery", "Adapter not ready, skipping", { adapter: adapterName });
    return { processed: 0, delivered: 0, failed: 0 };
  }

  const pending = await getPendingDeliveries(adapterName, batchSize);
  let delivered = 0;
  let failed = 0;

  for (const entry of pending) {
    try {
      const result = await adapter.deliver({
        notificationId: entry.notificationId,
        recipientId: entry.recipientId,
        payload: entry.payload,
      });

      if (result.ok) {
        await markDelivered(entry.id);
        delivered++;

        addBreadcrumb("delivery", "Outbox entry delivered", {
          outboxId: entry.id,
          notificationId: entry.notificationId,
          adapter: adapterName,
        });
      } else {
        await markFailed(entry.id, result.error, result.retryable);
        failed++;

        addBreadcrumb("delivery", "Outbox entry failed", {
          outboxId: entry.id,
          notificationId: entry.notificationId,
          adapter: adapterName,
          error: result.error,
          retryable: result.retryable,
        });
      }
    } catch (error) {
      await markFailed(entry.id, error.message, true);
      failed++;

      console.error("[Delivery] Error processing outbox entry:", error);
      captureError(error, {
        component: "DeliveryService",
        operation: "processOutbox",
        outboxId: entry.id,
        notificationId: entry.notificationId,
        adapter: adapterName,
      });
    }
  }

  return { processed: pending.length, delivered, failed };
}

/**
 * Starts the background delivery worker.
 *
 * @param {number} intervalMs - Processing interval in milliseconds
 * @returns {NodeJS.Timer}
 */
export function startDeliveryWorker(intervalMs = 5000) {
  if (workerInterval) {
    console.warn("[Delivery] Worker already running");
    return workerInterval;
  }

  workerInterval = setInterval(async () => {
    if (isProcessing) {
      return; // Skip if previous batch still processing
    }

    isProcessing = true;

    try {
      const adapters = getAllAdapters();

      for (const adapter of adapters) {
        const result = await processOutbox(adapter.name);

        if (result.processed > 0) {
          console.log(
            `[Delivery] Processed ${result.processed} entries for ${adapter.name}: ` +
            `${result.delivered} delivered, ${result.failed} failed`
          );
        }
      }
    } catch (error) {
      console.error("[Delivery] Worker error:", error);
      captureError(error, {
        component: "DeliveryService",
        operation: "worker",
      });
    } finally {
      isProcessing = false;
    }
  }, intervalMs);

  console.log(`[Delivery] Worker started (interval: ${intervalMs}ms)`);
  return workerInterval;
}

/**
 * Stops the background delivery worker.
 */
export function stopDeliveryWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("[Delivery] Worker stopped");
  }
}

/**
 * Gets delivery worker status.
 *
 * @returns {{running: boolean, processing: boolean}}
 */
export function getWorkerStatus() {
  return {
    running: workerInterval !== null,
    processing: isProcessing,
  };
}
