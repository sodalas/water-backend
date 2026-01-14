/**
 * PushAdapter.js
 *
 * Phase E.4: Push Notification Delivery Adapter
 *
 * Implements the DeliveryAdapter interface for FCM-based
 * push notification delivery.
 *
 * Invariants:
 * - E.3.1: Does not create meaning (transport only)
 * - E.3.2: At-least-once delivery (client dedupes)
 * - E.3.3: Offline safety (returns failure if no token)
 * - E.3.4: Observable (all attempts logged)
 *
 * Canon constraints:
 * - Firebase is TRANSPORT ONLY - no semantics, priority, or timing logic
 * - Payload passed through unchanged - no transformation, no enrichment
 * - Data-only FCM messages (no `notification` field)
 * - Delivery ≠ truth: success does NOT imply persistence
 * - Failure isolation: push failure does NOT affect domain state
 */

import { DeliveryAdapter } from "../../domain/notifications/DeliveryAdapter.js";
import { addBreadcrumb } from "../../sentry.js";

// Firebase Admin SDK - lazily imported to allow graceful degradation
let admin = null;
let firebaseInitialized = false;
let firebaseInitError = null;
let initializationPromise = null;

/**
 * Async initialization for Firebase Admin SDK.
 * Returns true if initialized successfully, false otherwise.
 */
async function ensureFirebaseInitialized() {
  // Return cached result if already initialized
  if (firebaseInitialized) {
    return firebaseInitError === null;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    // Check if push is explicitly disabled
    if (process.env.PUSH_ENABLED === "false") {
      console.log("[Push] Push notifications disabled via PUSH_ENABLED=false");
      firebaseInitialized = true;
      firebaseInitError = "Disabled";
      return false;
    }

    // Check for Firebase credentials
    const hasGoogleCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const hasInlineCredentials = !!process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!hasGoogleCredentials && !hasInlineCredentials) {
      console.log("[Push] No Firebase credentials found. Push notifications disabled.");
      console.log("[Push] Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT to enable.");
      firebaseInitialized = true;
      firebaseInitError = "No credentials";
      return false;
    }

    try {
      // Dynamic import to allow graceful degradation
      const firebaseAdmin = await import("firebase-admin");
      admin = firebaseAdmin.default || firebaseAdmin;

      if (admin.apps.length > 0) {
        // Already initialized
        firebaseInitialized = true;
        return true;
      }

      if (hasInlineCredentials) {
        // Parse inline JSON credentials
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        // Use GOOGLE_APPLICATION_CREDENTIALS (auto-detected by SDK)
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }

      console.log("[Push] Firebase Admin SDK initialized successfully");
      firebaseInitialized = true;
      return true;
    } catch (error) {
      console.error("[Push] Failed to initialize Firebase Admin SDK:", error.message);
      firebaseInitialized = true;
      firebaseInitError = error.message;
      return false;
    }
  })();

  return initializationPromise;
}

/**
 * Push notification delivery adapter for FCM-based delivery.
 *
 * TRANSPORT ONLY - does not interpret or modify notification content.
 */
export class PushAdapter extends DeliveryAdapter {
  constructor() {
    super("push");
  }

  /**
   * Checks if Firebase is initialized and ready.
   *
   * @returns {Promise<boolean>}
   */
  async isReady() {
    return await ensureFirebaseInitialized();
  }

  /**
   * Delivers a notification to a recipient via FCM push.
   *
   * TRANSPORT ONLY:
   * - Passes payload unchanged (no transformation)
   * - Uses data-only messages (no `notification` field)
   * - Does NOT set priority, TTL, or collapse keys based on content
   *
   * @param {Object} input
   * @param {string} input.notificationId
   * @param {string} input.recipientId
   * @param {Object} input.payload
   * @returns {Promise<{ok: true} | {ok: false, retryable: boolean, error: string}>}
   */
  async deliver({ notificationId, recipientId, payload }) {
    addBreadcrumb("push-adapter", "Attempting delivery", {
      notificationId,
      recipientId,
      payloadType: payload.type,
    });

    // Ensure Firebase is initialized
    if (!(await this.isReady())) {
      addBreadcrumb("push-adapter", "Firebase not initialized", {
        notificationId,
        recipientId,
      });

      return {
        ok: false,
        retryable: false,
        error: "Firebase not initialized",
      };
    }

    // TODO: Lookup device token for recipient
    // This requires a device_tokens table that will be added when implementing
    // mobile app registration. For now, we return gracefully if no token.
    const deviceToken = await this._getDeviceToken(recipientId);

    if (!deviceToken) {
      addBreadcrumb("push-adapter", "No device token for recipient", {
        notificationId,
        recipientId,
      });

      // No device token is not an error - user hasn't registered for push
      return {
        ok: false,
        retryable: false,
        error: "No device token",
      };
    }

    try {
      // Build FCM message - DATA ONLY (no `notification` field)
      // This ensures the app handles presentation, not FCM
      const message = {
        token: deviceToken,
        data: {
          notificationId,
          // Stringify all payload values (FCM data must be strings)
          ...Object.fromEntries(
            Object.entries(payload).map(([k, v]) => [k, String(v ?? "")])
          ),
        },
        // NO priority, TTL, or collapse_key - transport only
        // NO notification field - data-only message
      };

      await admin.messaging().send(message);

      addBreadcrumb("push-adapter", "Delivery successful", {
        notificationId,
        recipientId,
      });

      return { ok: true };
    } catch (error) {
      addBreadcrumb("push-adapter", "Delivery failed", {
        notificationId,
        recipientId,
        error: error.message,
        code: error.code,
      });

      // Check for non-retryable token errors
      if (
        error.code === "messaging/registration-token-not-registered" ||
        error.code === "messaging/invalid-registration-token"
      ) {
        // Token is invalid - don't retry
        // TODO: Mark token as invalid in device_tokens table
        return {
          ok: false,
          retryable: false,
          error: `Invalid token: ${error.code}`,
        };
      }

      // All other errors are potentially transient - retry
      return {
        ok: false,
        retryable: true,
        error: error.message,
      };
    }
  }

  /**
   * Look up device token for a recipient.
   *
   * TODO: Implement when device_tokens table is added.
   * For now, returns null (no tokens registered).
   *
   * @param {string} recipientId
   * @returns {Promise<string|null>}
   */
  async _getDeviceToken(recipientId) {
    // TODO: Query device_tokens table for this recipient's FCM token
    // For now, return null to indicate no token registered
    return null;
  }

  /**
   * Closes the adapter. No-op for Firebase Admin SDK.
   *
   * @returns {Promise<void>}
   */
  async close() {
    // Firebase Admin SDK doesn't require explicit cleanup
  }
}

// Singleton instance
let pushAdapter = null;

/**
 * Gets or creates the Push adapter instance.
 *
 * Returns null if Firebase credentials are not configured,
 * allowing graceful degradation.
 *
 * @returns {Promise<PushAdapter|null>}
 */
export async function getPushAdapter() {
  if (pushAdapter) {
    return pushAdapter;
  }

  // Check if Firebase can be initialized
  const ready = await ensureFirebaseInitialized();

  if (!ready) {
    // Firebase not available - return null for graceful degradation
    return null;
  }

  pushAdapter = new PushAdapter();
  return pushAdapter;
}

/**
 * Synchronous check for whether push is available.
 * Used by DeliveryService to conditionally register.
 *
 * @returns {boolean}
 */
export function isPushAvailable() {
  // Check if disabled
  if (process.env.PUSH_ENABLED === "false") {
    return false;
  }

  // Check for credentials
  return !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT
  );
}

/**
 * Resets the adapter state (for testing only).
 * Clears the singleton instance and initialization state.
 */
export function _resetForTesting() {
  pushAdapter = null;
  firebaseInitialized = false;
  firebaseInitError = null;
  initializationPromise = null;
  admin = null;
}

/**
 * Injects a mock Firebase admin instance (for testing only).
 * This bypasses the normal initialization flow.
 *
 * @param {Object} mockAdmin - Mock admin instance with messaging() method
 */
export function _injectFirebaseForTesting(mockAdmin) {
  admin = mockAdmin;
  firebaseInitialized = true;
  firebaseInitError = null;
  initializationPromise = Promise.resolve(true);
}
