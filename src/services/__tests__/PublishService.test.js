// src/services/__tests__/PublishService.test.js
// Phase F.1: PublishService invariant tests
//
// Must assert:
// - PublishService produces identical outputs to old route behavior
// - Idempotency choreography: pending created before graph write, complete after
// - Exceptions are mapped to typed errors (AppError), not raw strings

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { publish } from "../PublishService.js";
import { pool } from "../../db.js";
import { ASSERTION_TYPES } from "../../domain/composer/CSO.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  IdempotencyError,
  RevisionConflictError,
} from "../../domain/errors/AppError.js";

// Mock dependencies
vi.mock("../../infrastructure/graph/getGraphAdapter.js", () => ({
  getGraphAdapter: vi.fn(),
}));

vi.mock("../../infrastructure/draft/DraftPersistence.js", () => ({
  deleteDraftForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../domain/notifications/NotificationService.js", () => ({
  notifyReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../sentry.js", () => ({
  captureError: vi.fn(),
  addBreadcrumb: vi.fn(),
  logNearMiss: vi.fn(),
}));

vi.mock("../IdempotencyReconciler.js", () => ({
  reconcilePending: vi.fn().mockResolvedValue(null),
}));

import { getGraphAdapter } from "../../infrastructure/graph/getGraphAdapter.js";
import { deleteDraftForUser } from "../../infrastructure/draft/DraftPersistence.js";
import { notifyReply } from "../../domain/notifications/NotificationService.js";
import { reconcilePending } from "../IdempotencyReconciler.js";

describe("Phase F.1: PublishService", () => {
  const testUserId = "user_publish_test";
  const testIdempotencyKey = "idem_publish_abc";
  const testAssertionId = "asrt_publish_xyz";
  const testCreatedAt = new Date().toISOString();

  const validViewer = {
    id: testUserId,
    email: "test@example.com",
    name: "Test User",
  };

  const validCSO = {
    assertionType: ASSERTION_TYPES.MOMENT,
    text: "Test assertion content",
    visibility: "public",
  };

  const validResponseCSO = {
    assertionType: ASSERTION_TYPES.RESPONSE,
    text: "Test response content",
    visibility: "public",
    refs: [{ uri: "assertion:parent_123" }],
  };

  let mockGraph;

  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM publish_idempotency WHERE user_id = $1", [testUserId]);

    // Setup mock graph adapter
    mockGraph = {
      publish: vi.fn().mockResolvedValue({
        assertionId: testAssertionId,
        createdAt: testCreatedAt,
      }),
      getAssertionForRevision: vi.fn().mockResolvedValue(null),
    };
    getGraphAdapter.mockReturnValue(mockGraph);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await pool.query("DELETE FROM publish_idempotency WHERE user_id = $1", [testUserId]);
  });

  describe("Output shape (backwards compatibility)", () => {
    it("should return { assertionId, createdAt } for new publish", async () => {
      const result = await publish({
        viewer: validViewer,
        cso: validCSO,
      });

      expect(result).toHaveProperty("assertionId", testAssertionId);
      expect(result).toHaveProperty("createdAt", testCreatedAt);
      expect(result).not.toHaveProperty("replayed");
    });

    it("should return { assertionId, createdAt, replayed: true } for idempotent replay", async () => {
      // Setup: create complete idempotency record
      const existingCreatedAt = new Date();
      await pool.query(
        `INSERT INTO publish_idempotency
         (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
         VALUES ($1, $2, $3, 'complete', $4, $4 + INTERVAL '24 hours')`,
        [testIdempotencyKey, testUserId, testAssertionId, existingCreatedAt]
      );

      const result = await publish({
        viewer: validViewer,
        cso: validCSO,
        idempotencyKey: testIdempotencyKey,
      });

      expect(result).toHaveProperty("assertionId", testAssertionId);
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("replayed", true);
    });
  });

  describe("Idempotency choreography", () => {
    it("should create pending record BEFORE graph write", async () => {
      let pendingCreatedBeforePublish = false;

      mockGraph.publish.mockImplementation(async () => {
        // Check if pending record exists at the time of graph publish
        const check = await pool.query(
          `SELECT status FROM publish_idempotency
           WHERE idempotency_key = $1 AND user_id = $2`,
          [testIdempotencyKey, testUserId]
        );
        pendingCreatedBeforePublish = check.rowCount > 0 && check.rows[0].status === "pending";

        return { assertionId: testAssertionId, createdAt: testCreatedAt };
      });

      await publish({
        viewer: validViewer,
        cso: validCSO,
        idempotencyKey: testIdempotencyKey,
      });

      expect(pendingCreatedBeforePublish).toBe(true);
    });

    it("should complete idempotency record AFTER successful graph write", async () => {
      await publish({
        viewer: validViewer,
        cso: validCSO,
        idempotencyKey: testIdempotencyKey,
      });

      // Verify record is now complete
      const check = await pool.query(
        `SELECT status, assertion_id FROM publish_idempotency
         WHERE idempotency_key = $1 AND user_id = $2`,
        [testIdempotencyKey, testUserId]
      );

      expect(check.rows[0].status).toBe("complete");
      expect(check.rows[0].assertion_id).toBe(testAssertionId);
    });

    it("should leave pending record if graph write fails", async () => {
      mockGraph.publish.mockRejectedValue(new Error("Neo4j connection failed"));

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          idempotencyKey: testIdempotencyKey,
        })
      ).rejects.toThrow();

      // Verify record remains pending
      const check = await pool.query(
        `SELECT status, assertion_id FROM publish_idempotency
         WHERE idempotency_key = $1 AND user_id = $2`,
        [testIdempotencyKey, testUserId]
      );

      expect(check.rows[0].status).toBe("pending");
      expect(check.rows[0].assertion_id).toBeNull();
    });

    it("should attempt reconciliation when pending record found", async () => {
      // Create stale pending record
      await pool.query(
        `INSERT INTO publish_idempotency
         (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
         VALUES ($1, $2, NULL, 'pending', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '24 hours')`,
        [testIdempotencyKey, testUserId]
      );

      // Mock reconciliation failure
      reconcilePending.mockResolvedValue(null);

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          idempotencyKey: testIdempotencyKey,
        })
      ).rejects.toThrow(IdempotencyError);

      expect(reconcilePending).toHaveBeenCalledWith(testIdempotencyKey, testUserId);
    });

    it("should return reconciled result when reconciliation succeeds", async () => {
      // Create stale pending record
      await pool.query(
        `INSERT INTO publish_idempotency
         (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
         VALUES ($1, $2, NULL, 'pending', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '24 hours')`,
        [testIdempotencyKey, testUserId]
      );

      // Mock successful reconciliation
      const reconciledTime = new Date();
      reconcilePending.mockResolvedValue({
        assertionId: "asrt_reconciled",
        createdAt: reconciledTime,
      });

      const result = await publish({
        viewer: validViewer,
        cso: validCSO,
        idempotencyKey: testIdempotencyKey,
      });

      expect(result.assertionId).toBe("asrt_reconciled");
      expect(result.replayed).toBe(true);
    });
  });

  describe("Typed errors (not raw strings)", () => {
    it("should throw ValidationError for invalid CSO", async () => {
      const invalidCSO = { assertionType: ASSERTION_TYPES.MOMENT }; // missing text

      await expect(
        publish({
          viewer: validViewer,
          cso: invalidCSO,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("should throw NotFoundError when superseded assertion not found", async () => {
      mockGraph.getAssertionForRevision.mockResolvedValue(null);

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          supersedesId: "nonexistent_assertion",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw ConflictError when assertion already superseded", async () => {
      mockGraph.getAssertionForRevision.mockResolvedValue({
        id: "original_assertion",
        authorId: testUserId,
        supersedesId: "already_has_revision", // Already superseded
      });

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          supersedesId: "original_assertion",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("should throw ForbiddenError when user cannot revise", async () => {
      mockGraph.getAssertionForRevision.mockResolvedValue({
        id: "original_assertion",
        authorId: "different_user", // Different author
        supersedesId: null,
      });

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          supersedesId: "original_assertion",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("should throw RevisionConflictError on Neo4j constraint violation", async () => {
      mockGraph.getAssertionForRevision.mockResolvedValue({
        id: "original_assertion",
        authorId: testUserId,
        supersedesId: null,
      });

      const constraintError = new Error("Constraint violated");
      constraintError.code = "Neo.ClientError.Schema.ConstraintValidationFailed";
      mockGraph.publish.mockRejectedValue(constraintError);

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          supersedesId: "original_assertion",
        })
      ).rejects.toThrow(RevisionConflictError);
    });

    it("should throw IdempotencyError when pending record cannot be reconciled", async () => {
      // Create pending record
      await pool.query(
        `INSERT INTO publish_idempotency
         (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
         VALUES ($1, $2, NULL, 'pending', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '24 hours')`,
        [testIdempotencyKey, testUserId]
      );

      reconcilePending.mockResolvedValue(null);

      await expect(
        publish({
          viewer: validViewer,
          cso: validCSO,
          idempotencyKey: testIdempotencyKey,
        })
      ).rejects.toThrow(IdempotencyError);
    });
  });

  describe("Side effects", () => {
    it("should fire reply notification for response assertions", async () => {
      await publish({
        viewer: validViewer,
        cso: validResponseCSO,
      });

      expect(notifyReply).toHaveBeenCalledWith({
        actorId: testUserId,
        replyAssertionId: testAssertionId,
        parentAssertionId: "parent_123",
      });
    });

    it("should NOT fire notification for non-response assertions", async () => {
      await publish({
        viewer: validViewer,
        cso: validCSO,
      });

      expect(notifyReply).not.toHaveBeenCalled();
    });

    it("should clear draft when clearDraft is true", async () => {
      await publish({
        viewer: validViewer,
        cso: validCSO,
        clearDraft: true,
      });

      expect(deleteDraftForUser).toHaveBeenCalledWith(testUserId);
    });

    it("should NOT clear draft when clearDraft is false", async () => {
      await publish({
        viewer: validViewer,
        cso: validCSO,
        clearDraft: false,
      });

      expect(deleteDraftForUser).not.toHaveBeenCalled();
    });
  });

  describe("Graph adapter integration", () => {
    it("should pass correct parameters to graph.publish", async () => {
      await publish({
        viewer: validViewer,
        cso: validCSO,
        clientId: "client_123",
      });

      expect(mockGraph.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          viewer: expect.objectContaining({
            id: testUserId,
            handle: "test@example.com",
            displayName: "Test User",
          }),
          cso: validCSO,
          clientId: "client_123",
          supersedesId: undefined,
          revisionMetadata: null,
        })
      );
    });

    it("should include revision metadata when supersedesId provided", async () => {
      mockGraph.getAssertionForRevision.mockResolvedValue({
        id: "original_assertion",
        authorId: testUserId,
        supersedesId: null,
      });

      await publish({
        viewer: validViewer,
        cso: validCSO,
        supersedesId: "original_assertion",
      });

      expect(mockGraph.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          supersedesId: "original_assertion",
          revisionMetadata: {
            revisionNumber: 1,
            rootAssertionId: "original_assertion",
          },
        })
      );
    });
  });
});
