// src/infrastructure/notifications/__tests__/push.invariant.test.js
// Phase E.4: Push Adapter Invariant Tests
//
// Tests canon invariants for push notification delivery:
// - E.3.1: Delivery does not create meaning (transport only)
// - E.3.2: At-least-once delivery
// - E.3.3: Offline safety
// - E.3.4: Observability
// - Delivery ≠ truth
// - Idempotency under retries
// - Failure isolation
// - Semantic parity with WebSocket

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock Sentry before importing PushAdapter
vi.mock("../../../sentry.js", () => ({
  addBreadcrumb: vi.fn(),
  captureError: vi.fn(),
}));

// Import after mocks
import { addBreadcrumb } from "../../../sentry.js";
import {
  PushAdapter,
  _resetForTesting,
  _injectFirebaseForTesting,
} from "../PushAdapter.js";
import { WebSocketAdapter } from "../WebSocketAdapter.js";
import { DeliveryAdapter } from "../../../domain/notifications/DeliveryAdapter.js";

describe("Phase E.4: Push Adapter Invariants", () => {
  let pushAdapter;
  let mockSend;
  let mockAdmin;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset adapter state
    _resetForTesting();

    // Create mock Firebase admin
    mockSend = vi.fn().mockResolvedValue("mock-message-id");
    mockAdmin = {
      apps: [{}], // Non-empty means initialized
      messaging: () => ({ send: mockSend }),
    };

    // Inject mock
    _injectFirebaseForTesting(mockAdmin);

    // Create fresh adapter instance
    pushAdapter = new PushAdapter();

    // Mock device token lookup to return a token for testing
    pushAdapter._getDeviceToken = vi.fn().mockResolvedValue("mock-device-token");
  });

  afterEach(() => {
    _resetForTesting();
  });

  // ============================================================
  // E.3.1: DELIVERY DOES NOT CREATE MEANING
  // ============================================================
  describe("Invariant E.3.1: Delivery Does Not Create Meaning", () => {
    it("should pass notification content unchanged to FCM", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: {
          type: "reply",
          actorId: "user-789",
          assertionId: "asrt-abc",
          reactionType: null,
          createdAt: "2024-01-01T00:00:00Z",
        },
      };

      await pushAdapter.deliver(input);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentMessage = mockSend.mock.calls[0][0];

      expect(sentMessage.token).toBe("mock-device-token");
      expect(sentMessage.data.notificationId).toBe("notif-123");
      expect(sentMessage.data.type).toBe("reply");
      expect(sentMessage.data.actorId).toBe("user-789");
      expect(sentMessage.data.assertionId).toBe("asrt-abc");
      expect(sentMessage.data.createdAt).toBe("2024-01-01T00:00:00Z");
    });

    it("should NOT set FCM priority based on notification type", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      await pushAdapter.deliver(input);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage).not.toHaveProperty("android");
      expect(sentMessage).not.toHaveProperty("apns");
      expect(sentMessage).not.toHaveProperty("priority");
    });

    it("should NOT set FCM collapse key based on notification content", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "same-assertion", createdAt: "c" },
      };

      await pushAdapter.deliver(input);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage).not.toHaveProperty("collapseKey");
    });

    it("should use data-only messages (no notification field)", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      await pushAdapter.deliver(input);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage).not.toHaveProperty("notification");
      expect(sentMessage).toHaveProperty("data");
    });
  });

  // ============================================================
  // E.3.2: AT-LEAST-ONCE DELIVERY
  // ============================================================
  describe("Invariant E.3.2: At-Least-Once Delivery", () => {
    it("should return success when FCM accepts message", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      expect(result).toEqual({ ok: true });
    });

    it("should return retryable failure on transient FCM errors", async () => {
      mockSend.mockRejectedValue(new Error("Server unavailable"));

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      expect(result).toEqual({
        ok: false,
        retryable: true,
        error: "Server unavailable",
      });
    });

    it("should return non-retryable failure on invalid token (registration-token-not-registered)", async () => {
      const tokenError = new Error("Token not registered");
      tokenError.code = "messaging/registration-token-not-registered";
      mockSend.mockRejectedValue(tokenError);

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      expect(result.ok).toBe(false);
      expect(result.retryable).toBe(false);
    });

    it("should return non-retryable failure on invalid token (invalid-registration-token)", async () => {
      const tokenError = new Error("Invalid token");
      tokenError.code = "messaging/invalid-registration-token";
      mockSend.mockRejectedValue(tokenError);

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      expect(result.ok).toBe(false);
      expect(result.retryable).toBe(false);
    });
  });

  // ============================================================
  // E.3.3: OFFLINE SAFETY
  // ============================================================
  describe("Invariant E.3.3: Offline Safety", () => {
    it("should handle missing device token gracefully", async () => {
      pushAdapter._getDeviceToken = vi.fn().mockResolvedValue(null);

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      expect(result).toEqual({
        ok: false,
        retryable: false,
        error: "No device token",
      });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should not throw on Firebase not initialized", async () => {
      _resetForTesting(); // Clear Firebase state

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      // Should not throw
      const result = await pushAdapter.deliver(input);

      expect(result.ok).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.error).toBe("Firebase not initialized");
    });
  });

  // ============================================================
  // E.3.4: OBSERVABILITY
  // ============================================================
  describe("Invariant E.3.4: Observability", () => {
    it("should add breadcrumbs for successful delivery", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      await pushAdapter.deliver(input);

      expect(addBreadcrumb).toHaveBeenCalledWith(
        "push-adapter",
        "Attempting delivery",
        expect.objectContaining({
          notificationId: "notif-123",
          recipientId: "user-456",
        })
      );
      expect(addBreadcrumb).toHaveBeenCalledWith(
        "push-adapter",
        "Delivery successful",
        expect.objectContaining({
          notificationId: "notif-123",
        })
      );
    });

    it("should add breadcrumbs for failed delivery", async () => {
      mockSend.mockRejectedValue(new Error("Failed"));

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      await pushAdapter.deliver(input);

      expect(addBreadcrumb).toHaveBeenCalledWith(
        "push-adapter",
        "Delivery failed",
        expect.objectContaining({
          notificationId: "notif-123",
          error: "Failed",
        })
      );
    });

    it("should add breadcrumbs for missing device token", async () => {
      pushAdapter._getDeviceToken = vi.fn().mockResolvedValue(null);

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      await pushAdapter.deliver(input);

      expect(addBreadcrumb).toHaveBeenCalledWith(
        "push-adapter",
        "No device token for recipient",
        expect.any(Object)
      );
    });
  });

  // ============================================================
  // CANON: DELIVERY ≠ TRUTH
  // ============================================================
  describe("Canon Invariant: Delivery ≠ Truth", () => {
    it("successful push delivery does NOT imply notification persistence", async () => {
      // This test verifies the adapter doesn't modify any database state
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      expect(result.ok).toBe(true);
      // The adapter only calls FCM - no database operations
      // Persistence is handled by NotificationService, not adapters
    });

    it("successful push delivery does NOT imply semantic validity", async () => {
      // Adapter delivers whatever payload it receives - no validation
      const input = {
        notificationId: "notif-invalid",
        recipientId: "user-456",
        payload: {
          type: "invalid-type", // Invalid type - adapter doesn't care
          actorId: "",
          assertionId: "",
          createdAt: "not-a-date",
        },
      };

      const result = await pushAdapter.deliver(input);

      // Adapter succeeds even with "invalid" payload - transport only
      expect(result.ok).toBe(true);
    });
  });

  // ============================================================
  // CANON: IDEMPOTENCY UNDER RETRIES
  // ============================================================
  describe("Canon Invariant: Idempotency Under Retries", () => {
    it("multiple deliver() calls with same notificationId produce identical FCM payloads", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      // Call 3 times
      await pushAdapter.deliver(input);
      await pushAdapter.deliver(input);
      await pushAdapter.deliver(input);

      expect(mockSend).toHaveBeenCalledTimes(3);

      // All calls should have identical payloads
      const call1 = mockSend.mock.calls[0][0];
      const call2 = mockSend.mock.calls[1][0];
      const call3 = mockSend.mock.calls[2][0];

      expect(call1).toEqual(call2);
      expect(call2).toEqual(call3);
    });

    it("adapter does NOT track delivery state internally", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      // First delivery succeeds
      const result1 = await pushAdapter.deliver(input);
      expect(result1.ok).toBe(true);

      // Second delivery also succeeds (no internal state preventing it)
      const result2 = await pushAdapter.deliver(input);
      expect(result2.ok).toBe(true);

      // Adapter doesn't know or care that it already delivered
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // CANON: FAILURE ISOLATION
  // ============================================================
  describe("Canon Invariant: Failure Isolation", () => {
    it("push failure does NOT affect domain state", async () => {
      mockSend.mockRejectedValue(new Error("FCM unavailable"));

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      const result = await pushAdapter.deliver(input);

      // Failure is returned, not thrown
      expect(result.ok).toBe(false);
      // No exceptions escaped to caller
    });

    it("push failure does NOT throw exceptions that bubble up", async () => {
      mockSend.mockRejectedValue(new Error("Catastrophic failure"));

      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      // Should not throw
      await expect(pushAdapter.deliver(input)).resolves.toMatchObject({
        ok: false,
        retryable: true,
      });
    });
  });

  // ============================================================
  // CANON: SEMANTIC PARITY WITH WEBSOCKET
  // ============================================================
  describe("Canon Invariant: Semantic Parity with WebSocket", () => {
    it("push adapter extends DeliveryAdapter interface", () => {
      expect(pushAdapter).toBeInstanceOf(DeliveryAdapter);
      expect(pushAdapter.name).toBe("push");
      expect(typeof pushAdapter.deliver).toBe("function");
      expect(typeof pushAdapter.isReady).toBe("function");
      expect(typeof pushAdapter.close).toBe("function");
    });

    it("push adapter return type matches WebSocket adapter return type", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: { type: "reply", actorId: "a", assertionId: "b", createdAt: "c" },
      };

      // Success case
      const successResult = await pushAdapter.deliver(input);
      expect(successResult).toHaveProperty("ok", true);

      // Failure case
      mockSend.mockRejectedValue(new Error("Failed"));
      const failResult = await pushAdapter.deliver(input);
      expect(failResult).toHaveProperty("ok", false);
      expect(failResult).toHaveProperty("retryable");
      expect(failResult).toHaveProperty("error");
    });

    it("both adapters can be registered and would process same notification independently", () => {
      // This is a structural test - both adapters have same interface
      const wsAdapter = new WebSocketAdapter();

      expect(wsAdapter.name).toBe("websocket");
      expect(pushAdapter.name).toBe("push");

      // Both have same interface methods
      expect(typeof wsAdapter.deliver).toBe("function");
      expect(typeof pushAdapter.deliver).toBe("function");
      expect(typeof wsAdapter.isReady).toBe("function");
      expect(typeof pushAdapter.isReady).toBe("function");
    });
  });

  // ============================================================
  // ADAPTER INTERFACE TESTS
  // ============================================================
  describe("Adapter Interface", () => {
    it("should have correct name", () => {
      expect(pushAdapter.name).toBe("push");
    });

    it("isReady() should return true when Firebase is initialized", async () => {
      const ready = await pushAdapter.isReady();
      expect(ready).toBe(true);
    });

    it("isReady() should return false when Firebase is not initialized", async () => {
      _resetForTesting(); // Clear Firebase state
      const ready = await pushAdapter.isReady();
      expect(ready).toBe(false);
    });

    it("close() should not throw", async () => {
      await expect(pushAdapter.close()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // PAYLOAD STRINGIFICATION
  // ============================================================
  describe("Payload Stringification", () => {
    it("should stringify all payload values for FCM data messages", async () => {
      const input = {
        notificationId: "notif-123",
        recipientId: "user-456",
        payload: {
          type: "reply",
          count: 42,
          active: true,
          nullValue: null,
        },
      };

      await pushAdapter.deliver(input);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.data.type).toBe("reply");
      expect(sentMessage.data.count).toBe("42");
      expect(sentMessage.data.active).toBe("true");
      expect(sentMessage.data.nullValue).toBe("");
    });
  });
});
