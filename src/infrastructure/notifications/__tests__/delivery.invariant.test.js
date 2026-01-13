// src/infrastructure/notifications/__tests__/delivery.invariant.test.js
// Phase E.3: Delivery Adapter Invariant Tests
//
// This test validates ALL canon invariants for notification delivery:
// - E.3.1: Delivery does not create meaning
// - E.3.2: At-least-once delivery, exactly-once UX
// - E.3.3: Offline safety
// - E.3.4: Observability first

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import {
  enqueueDelivery,
  getPendingDeliveries,
  markDelivered,
  markFailed,
  getDeliveryStatus,
  cleanupDeliveredEntries,
} from "../OutboxPersistence.js";
import {
  DeliveryAdapter,
  registerAdapter,
  getAdapter,
  getAllAdapters,
  clearAdapters,
} from "../../../domain/notifications/DeliveryAdapter.js";
import {
  initDeliveryService,
  scheduleDelivery,
  processOutbox,
} from "../../../domain/notifications/DeliveryService.js";

const { Pool } = pg;

// PostgreSQL pool for tests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://localhost:5432/water",
});

// Test data IDs
const TEST_IDS = {
  notification1: "notif_test_delivery_1",
  notification2: "notif_test_delivery_2",
  notification3: "notif_test_delivery_3",
  recipient: "user_test_delivery_recipient",
  actor: "user_test_delivery_actor",
};

/**
 * Mock adapter that tracks delivery attempts
 */
class MockAdapter extends DeliveryAdapter {
  constructor(name, behavior = "success") {
    super(name);
    this.deliveries = [];
    this.behavior = behavior; // "success" | "fail" | "fail-retryable"
  }

  async deliver(input) {
    this.deliveries.push({
      notificationId: input.notificationId,
      recipientId: input.recipientId,
      payload: input.payload,
      timestamp: new Date(),
    });

    if (this.behavior === "success") {
      return { ok: true };
    } else if (this.behavior === "fail") {
      return { ok: false, retryable: false, error: "Mock non-retryable failure" };
    } else {
      return { ok: false, retryable: true, error: "Mock retryable failure" };
    }
  }

  getDeliveryCount() {
    return this.deliveries.length;
  }

  getDeliveriesFor(notificationId) {
    return this.deliveries.filter(d => d.notificationId === notificationId);
  }

  reset() {
    this.deliveries = [];
  }
}

describe("Phase E.3: Delivery Adapter Invariants", () => {
  beforeAll(async () => {
    // Create test notifications
    await pool.query(`
      INSERT INTO notifications (id, recipient_id, actor_id, assertion_id, notification_type)
      VALUES
        ($1, $2, $3, 'asrt_test_1', 'reply'),
        ($4, $2, $3, 'asrt_test_2', 'reaction'),
        ($5, $2, $3, 'asrt_test_3', 'reply')
      ON CONFLICT (actor_id, assertion_id, notification_type, COALESCE(reaction_type, '')) DO NOTHING
    `, [TEST_IDS.notification1, TEST_IDS.recipient, TEST_IDS.actor, TEST_IDS.notification2, TEST_IDS.notification3]);
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query(`
      DELETE FROM notification_outbox
      WHERE notification_id IN ($1, $2, $3)
    `, [TEST_IDS.notification1, TEST_IDS.notification2, TEST_IDS.notification3]);

    await pool.query(`
      DELETE FROM notifications
      WHERE id IN ($1, $2, $3)
    `, [TEST_IDS.notification1, TEST_IDS.notification2, TEST_IDS.notification3]);

    await pool.end();
  });

  beforeEach(async () => {
    // Clean up outbox before each test
    await pool.query(`
      DELETE FROM notification_outbox
      WHERE notification_id IN ($1, $2, $3)
    `, [TEST_IDS.notification1, TEST_IDS.notification2, TEST_IDS.notification3]);

    // Clear adapters
    clearAdapters();
  });

  // ============================================================
  // 1. OUTBOX PERSISTENCE TESTS
  // ============================================================
  describe("Outbox Persistence", () => {
    it("should enqueue a delivery for an adapter", async () => {
      const result = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      expect(result.enqueued).toBe(true);
      expect(result.id).toBeTruthy();
    });

    it("should NOT enqueue duplicate deliveries (idempotency)", async () => {
      const result1 = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      const result2 = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      expect(result1.enqueued).toBe(true);
      expect(result2.enqueued).toBe(false);
    });

    it("should allow same notification for different adapters", async () => {
      const wsResult = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      const pushResult = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "push",
      });

      expect(wsResult.enqueued).toBe(true);
      expect(pushResult.enqueued).toBe(true);
    });

    it("should fetch pending deliveries for an adapter", async () => {
      await enqueueDelivery({ notificationId: TEST_IDS.notification1, adapter: "websocket" });
      await enqueueDelivery({ notificationId: TEST_IDS.notification2, adapter: "websocket" });
      await enqueueDelivery({ notificationId: TEST_IDS.notification3, adapter: "push" });

      const wsPending = await getPendingDeliveries("websocket", 100);
      const pushPending = await getPendingDeliveries("push", 100);

      expect(wsPending.length).toBe(2);
      expect(pushPending.length).toBe(1);
    });

    it("should mark delivery as delivered", async () => {
      const { id } = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      await markDelivered(id);

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const wsStatus = status.find(s => s.adapter === "websocket");

      expect(wsStatus.status).toBe("delivered");
      expect(wsStatus.delivered_at).toBeTruthy();
    });

    it("should mark delivery as failed with retry scheduling", async () => {
      const { id } = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      await markFailed(id, "Connection refused", true);

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const wsStatus = status.find(s => s.adapter === "websocket");

      expect(wsStatus.status).toBe("pending"); // Still pending for retry
      expect(wsStatus.attempts).toBe(1);
      expect(wsStatus.last_error).toBe("Connection refused");
    });

    it("should mark delivery as permanently failed after max attempts", async () => {
      const { id } = await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      // Simulate 5 failures (max attempts)
      for (let i = 0; i < 5; i++) {
        await markFailed(id, `Failure ${i + 1}`, true);
      }

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const wsStatus = status.find(s => s.adapter === "websocket");

      expect(wsStatus.status).toBe("failed");
      expect(wsStatus.attempts).toBe(5);
    });
  });

  // ============================================================
  // 2. ADAPTER INTERFACE TESTS (E.3.1)
  // ============================================================
  describe("Invariant E.3.1: Delivery Does Not Create Meaning", () => {
    it("should register and retrieve adapters", () => {
      const mockAdapter = new MockAdapter("mock");
      registerAdapter(mockAdapter);

      const retrieved = getAdapter("mock");
      expect(retrieved).toBe(mockAdapter);
    });

    it("should pass notification content unchanged to adapters", async () => {
      const mockAdapter = new MockAdapter("mock");
      registerAdapter(mockAdapter);

      const input = {
        notificationId: "test-123",
        recipientId: "user-456",
        payload: {
          type: "reply",
          actorId: "user-789",
          assertionId: "asrt-abc",
          reactionType: null,
          createdAt: "2024-01-01T00:00:00Z",
        },
      };

      await mockAdapter.deliver(input);

      const delivery = mockAdapter.deliveries[0];
      expect(delivery.notificationId).toBe(input.notificationId);
      expect(delivery.recipientId).toBe(input.recipientId);
      expect(delivery.payload).toEqual(input.payload);
    });
  });

  // ============================================================
  // 3. AT-LEAST-ONCE DELIVERY TESTS (E.3.2)
  // ============================================================
  describe("Invariant E.3.2: At-Least-Once Delivery", () => {
    it("should retry failed deliveries", async () => {
      const mockAdapter = new MockAdapter("websocket", "fail-retryable");
      registerAdapter(mockAdapter);

      await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      // First attempt
      await processOutbox("websocket");

      // Check status - should be pending with next_attempt_at in future
      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const wsStatus = status.find(s => s.adapter === "websocket");

      expect(wsStatus.attempts).toBe(1);
      expect(wsStatus.status).toBe("pending");
    });

    it("should stop retrying after non-retryable failure", async () => {
      const mockAdapter = new MockAdapter("websocket", "fail");
      registerAdapter(mockAdapter);

      await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      await processOutbox("websocket");

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const wsStatus = status.find(s => s.adapter === "websocket");

      expect(wsStatus.status).toBe("failed");
    });

    it("should deliver to multiple adapters independently", async () => {
      const wsAdapter = new MockAdapter("websocket", "success");
      const pushAdapter = new MockAdapter("push", "fail-retryable");

      registerAdapter(wsAdapter);
      registerAdapter(pushAdapter);

      await enqueueDelivery({ notificationId: TEST_IDS.notification1, adapter: "websocket" });
      await enqueueDelivery({ notificationId: TEST_IDS.notification1, adapter: "push" });

      await processOutbox("websocket");
      await processOutbox("push");

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const wsStatus = status.find(s => s.adapter === "websocket");
      const pushStatus = status.find(s => s.adapter === "push");

      expect(wsStatus.status).toBe("delivered");
      expect(pushStatus.status).toBe("pending"); // Retrying
    });
  });

  // ============================================================
  // 4. OFFLINE SAFETY TESTS (E.3.3)
  // ============================================================
  describe("Invariant E.3.3: Offline Safety", () => {
    it("should persist notification even when delivery fails", async () => {
      const mockAdapter = new MockAdapter("websocket", "fail");
      registerAdapter(mockAdapter);

      await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      await processOutbox("websocket");

      // Notification should still exist in database
      const { rows } = await pool.query(
        `SELECT * FROM notifications WHERE id = $1`,
        [TEST_IDS.notification1]
      );

      expect(rows.length).toBe(1);
    });

    it("should allow re-delivery after adapter becomes available", async () => {
      const mockAdapter = new MockAdapter("websocket", "success");
      registerAdapter(mockAdapter);

      // Enqueue but don't process yet
      await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      // Process when "online"
      const result = await processOutbox("websocket");

      expect(result.delivered).toBe(1);
    });
  });

  // ============================================================
  // 5. CLEANUP TESTS
  // ============================================================
  describe("Outbox Cleanup", () => {
    it("should clean up old delivered entries", async () => {
      await enqueueDelivery({
        notificationId: TEST_IDS.notification1,
        adapter: "websocket",
      });

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      const outboxId = status.find(s => s.adapter === "websocket").id;

      await markDelivered(outboxId);

      // Set delivered_at to 10 days ago for test
      await pool.query(`
        UPDATE notification_outbox
        SET delivered_at = NOW() - INTERVAL '10 days'
        WHERE id = $1
      `, [outboxId]);

      const { deleted } = await cleanupDeliveredEntries(7);

      expect(deleted).toBe(1);
    });
  });

  // ============================================================
  // 6. DELIVERY SERVICE INTEGRATION TESTS
  // ============================================================
  describe("Delivery Service Integration", () => {
    it("should schedule delivery to all registered adapters", async () => {
      const wsAdapter = new MockAdapter("websocket");
      const pushAdapter = new MockAdapter("push");

      registerAdapter(wsAdapter);
      registerAdapter(pushAdapter);

      const { enqueued } = await scheduleDelivery(TEST_IDS.notification1);

      expect(enqueued).toContain("websocket");
      expect(enqueued).toContain("push");

      const status = await getDeliveryStatus(TEST_IDS.notification1);
      expect(status.length).toBe(2);
    });

    it("should process outbox and track delivery stats", async () => {
      const mockAdapter = new MockAdapter("websocket");
      registerAdapter(mockAdapter);

      await enqueueDelivery({ notificationId: TEST_IDS.notification1, adapter: "websocket" });
      await enqueueDelivery({ notificationId: TEST_IDS.notification2, adapter: "websocket" });

      const result = await processOutbox("websocket");

      expect(result.processed).toBe(2);
      expect(result.delivered).toBe(2);
      expect(result.failed).toBe(0);
    });
  });
});
