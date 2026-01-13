/**
 * DeliveryAdapter.js
 *
 * Phase E.3: Notification Delivery Adapter Interface
 *
 * Defines the contract for all notification delivery adapters.
 * Adapters are pluggable and must not alter notification semantics.
 *
 * Invariants (E.3.1):
 * - Adapters may NOT change notification content
 * - Adapters may NOT change recipients
 * - Adapters may NOT change suppression rules
 * - Delivery failures must NOT affect graph truth
 */

/**
 * @typedef {Object} NotificationPayload
 * @property {string} type - 'reply' or 'reaction'
 * @property {string} actorId - User who triggered the notification
 * @property {string} assertionId - The assertion involved
 * @property {string|null} reactionType - For reactions: 'like' or 'acknowledge'
 * @property {string} createdAt - ISO timestamp of notification creation
 */

/**
 * @typedef {Object} DeliveryInput
 * @property {string} notificationId - Unique notification ID (for deduplication)
 * @property {string} recipientId - User ID to deliver to
 * @property {NotificationPayload} payload - Notification content
 */

/**
 * @typedef {Object} DeliverySuccess
 * @property {true} ok
 */

/**
 * @typedef {Object} DeliveryFailure
 * @property {false} ok
 * @property {boolean} retryable - Whether delivery should be retried
 * @property {string} error - Error message for observability
 */

/**
 * @typedef {DeliverySuccess | DeliveryFailure} DeliveryResult
 */

/**
 * Base class for notification delivery adapters.
 *
 * All adapters must:
 * 1. Implement the `deliver` method
 * 2. Return appropriate success/failure results
 * 3. NOT modify notification content
 * 4. Handle failures gracefully
 */
export class DeliveryAdapter {
  /**
   * @type {string}
   */
  name;

  /**
   * Creates a new delivery adapter.
   *
   * @param {string} name - Adapter name ('websocket' | 'push')
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Delivers a notification to a recipient.
   *
   * @param {DeliveryInput} input - Delivery parameters
   * @returns {Promise<DeliveryResult>}
   */
  async deliver(input) {
    throw new Error("deliver() must be implemented by subclass");
  }

  /**
   * Checks if the adapter is ready to deliver.
   *
   * @returns {Promise<boolean>}
   */
  async isReady() {
    return true;
  }

  /**
   * Closes any resources held by the adapter.
   *
   * @returns {Promise<void>}
   */
  async close() {
    // Override in subclass if needed
  }
}

/**
 * Registry of available delivery adapters.
 *
 * @type {Map<string, DeliveryAdapter>}
 */
const adapterRegistry = new Map();

/**
 * Registers a delivery adapter.
 *
 * @param {DeliveryAdapter} adapter
 */
export function registerAdapter(adapter) {
  adapterRegistry.set(adapter.name, adapter);
}

/**
 * Gets a registered adapter by name.
 *
 * @param {string} name
 * @returns {DeliveryAdapter|undefined}
 */
export function getAdapter(name) {
  return adapterRegistry.get(name);
}

/**
 * Gets all registered adapters.
 *
 * @returns {DeliveryAdapter[]}
 */
export function getAllAdapters() {
  return Array.from(adapterRegistry.values());
}

/**
 * Clears all registered adapters (for testing).
 */
export function clearAdapters() {
  adapterRegistry.clear();
}
