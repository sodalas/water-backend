// src/services/__tests__/IdempotencyReconciler.test.js
// Phase F.1: Reconciliation invariant tests
//
// Must assert:
// - A stale pending record is completed if (and only if) Neo4j confirms assertion existence
// - A fresh pending record is not reconciled
// - If Neo4j cannot confirm, reconciliation does not mutate Postgres state

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reconcilePending, isRecordStale, getStaleThresholdMs } from "../IdempotencyReconciler.js";
import { pool } from "../../db.js";
import { getGraphAdapter } from "../../infrastructure/graph/getGraphAdapter.js";

// Mock the graph adapter
vi.mock("../../infrastructure/graph/getGraphAdapter.js", () => ({
  getGraphAdapter: vi.fn(),
}));

describe("Phase F.1: Idempotency Reconciliation", () => {
  const testUserId = "user_reconcile_test";
  const testIdempotencyKey = "idem_reconcile_abc";
  const testAssertionId = "asrt_reconcile_xyz";

  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM publish_idempotency WHERE user_id = $1", [testUserId]);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM publish_idempotency WHERE user_id = $1", [testUserId]);
  });

  describe("isRecordStale", () => {
    it("should return false for fresh records", () => {
      const freshDate = new Date(Date.now() - 1000); // 1 second ago
      expect(isRecordStale(freshDate)).toBe(false);
    });

    it("should return true for stale records", () => {
      const threshold = getStaleThresholdMs();
      const staleDate = new Date(Date.now() - threshold - 1000); // threshold + 1 second ago
      expect(isRecordStale(staleDate)).toBe(true);
    });

    it("should return true at exactly the threshold", () => {
      const threshold = getStaleThresholdMs();
      const exactDate = new Date(Date.now() - threshold);
      expect(isRecordStale(exactDate)).toBe(true);
    });
  });

  describe("reconcilePending", () => {
    describe("Fresh pending records", () => {
      it("should NOT reconcile fresh pending records", async () => {
        // Create fresh pending record
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, NULL, 'pending', NOW(), NOW() + INTERVAL '24 hours')`,
          [testIdempotencyKey, testUserId]
        );

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should return null (not reconciled)
        expect(result).toBeNull();

        // Record should still be pending
        const check = await pool.query(
          `SELECT status FROM publish_idempotency
           WHERE idempotency_key = $1 AND user_id = $2`,
          [testIdempotencyKey, testUserId]
        );
        expect(check.rows[0].status).toBe("pending");
      });
    });

    describe("Stale pending records WITHOUT Neo4j confirmation", () => {
      it("should NOT complete stale pending records when Neo4j cannot confirm", async () => {
        const threshold = getStaleThresholdMs();
        const staleTime = new Date(Date.now() - threshold - 60000); // threshold + 1 minute ago

        // Create stale pending record (no assertionId)
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, NULL, 'pending', $3, $3 + INTERVAL '24 hours')`,
          [testIdempotencyKey, testUserId, staleTime]
        );

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should return null (cannot auto-recover without assertionId)
        expect(result).toBeNull();

        // Record should still be pending (not mutated)
        const check = await pool.query(
          `SELECT status, assertion_id FROM publish_idempotency
           WHERE idempotency_key = $1 AND user_id = $2`,
          [testIdempotencyKey, testUserId]
        );
        expect(check.rows[0].status).toBe("pending");
        expect(check.rows[0].assertion_id).toBeNull();
      });
    });

    describe("Stale pending records WITH Neo4j confirmation", () => {
      it("should complete stale pending record when Neo4j confirms assertion exists", async () => {
        const threshold = getStaleThresholdMs();
        const staleTime = new Date(Date.now() - threshold - 60000);

        // Create stale pending record WITH assertionId (edge case: partial state)
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, $3, 'pending', $4, $4 + INTERVAL '24 hours')`,
          [testIdempotencyKey, testUserId, testAssertionId, staleTime]
        );

        // Mock graph adapter to confirm assertion exists
        const mockGraph = {
          getAssertionForRevision: vi.fn().mockResolvedValue({
            id: testAssertionId,
            authorId: testUserId, // Same user
            supersedesId: null,
          }),
        };
        getGraphAdapter.mockReturnValue(mockGraph);

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should return reconciled record
        expect(result).not.toBeNull();
        expect(result.assertionId).toBe(testAssertionId);

        // Record should be complete
        const check = await pool.query(
          `SELECT status, assertion_id FROM publish_idempotency
           WHERE idempotency_key = $1 AND user_id = $2`,
          [testIdempotencyKey, testUserId]
        );
        expect(check.rows[0].status).toBe("complete");
        expect(check.rows[0].assertion_id).toBe(testAssertionId);
      });

      it("should NOT complete when Neo4j assertion belongs to different user", async () => {
        const threshold = getStaleThresholdMs();
        const staleTime = new Date(Date.now() - threshold - 60000);

        // Create stale pending record WITH assertionId
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, $3, 'pending', $4, $4 + INTERVAL '24 hours')`,
          [testIdempotencyKey, testUserId, testAssertionId, staleTime]
        );

        // Mock graph adapter - assertion belongs to DIFFERENT user
        const mockGraph = {
          getAssertionForRevision: vi.fn().mockResolvedValue({
            id: testAssertionId,
            authorId: "different_user", // Different user!
            supersedesId: null,
          }),
        };
        getGraphAdapter.mockReturnValue(mockGraph);

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should NOT reconcile (author mismatch)
        expect(result).toBeNull();

        // Record should still be pending
        const check = await pool.query(
          `SELECT status FROM publish_idempotency
           WHERE idempotency_key = $1 AND user_id = $2`,
          [testIdempotencyKey, testUserId]
        );
        expect(check.rows[0].status).toBe("pending");
      });

      it("should NOT complete when Neo4j assertion does not exist", async () => {
        const threshold = getStaleThresholdMs();
        const staleTime = new Date(Date.now() - threshold - 60000);

        // Create stale pending record WITH assertionId
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, $3, 'pending', $4, $4 + INTERVAL '24 hours')`,
          [testIdempotencyKey, testUserId, testAssertionId, staleTime]
        );

        // Mock graph adapter - assertion NOT found
        const mockGraph = {
          getAssertionForRevision: vi.fn().mockResolvedValue(null),
        };
        getGraphAdapter.mockReturnValue(mockGraph);

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should NOT reconcile (assertion not found)
        expect(result).toBeNull();

        // Record should still be pending
        const check = await pool.query(
          `SELECT status FROM publish_idempotency
           WHERE idempotency_key = $1 AND user_id = $2`,
          [testIdempotencyKey, testUserId]
        );
        expect(check.rows[0].status).toBe("pending");
      });
    });

    describe("Edge cases", () => {
      it("should return null for non-existent pending record", async () => {
        const result = await reconcilePending("nonexistent_key", testUserId);
        expect(result).toBeNull();
      });

      it("should not attempt reconciliation for complete records", async () => {
        // Complete records are not returned by getPendingRecord (status filter)
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, $3, 'complete', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '24 hours')`,
          [testIdempotencyKey, testUserId, testAssertionId]
        );

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should return null (no pending record found)
        expect(result).toBeNull();
      });

      it("should not attempt reconciliation for expired records", async () => {
        // Expired records are filtered out
        await pool.query(
          `INSERT INTO publish_idempotency
           (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
           VALUES ($1, $2, NULL, 'pending', NOW() - INTERVAL '25 hours', NOW() - INTERVAL '1 hour')`,
          [testIdempotencyKey, testUserId]
        );

        const result = await reconcilePending(testIdempotencyKey, testUserId);

        // Should return null (expired record not found)
        expect(result).toBeNull();
      });
    });
  });

  describe("Invariant: Never complete without Neo4j confirmation", () => {
    it("should preserve pending state when Neo4j query fails", async () => {
      const threshold = getStaleThresholdMs();
      const staleTime = new Date(Date.now() - threshold - 60000);

      // Create stale pending record WITH assertionId
      await pool.query(
        `INSERT INTO publish_idempotency
         (idempotency_key, user_id, assertion_id, status, created_at, expires_at)
         VALUES ($1, $2, $3, 'pending', $4, $4 + INTERVAL '24 hours')`,
        [testIdempotencyKey, testUserId, testAssertionId, staleTime]
      );

      // Mock graph adapter to throw error
      const mockGraph = {
        getAssertionForRevision: vi.fn().mockRejectedValue(new Error("Neo4j connection failed")),
      };
      getGraphAdapter.mockReturnValue(mockGraph);

      const result = await reconcilePending(testIdempotencyKey, testUserId);

      // Should NOT reconcile (error during confirmation)
      expect(result).toBeNull();

      // Record should still be pending (invariant preserved)
      const check = await pool.query(
        `SELECT status FROM publish_idempotency
         WHERE idempotency_key = $1 AND user_id = $2`,
        [testIdempotencyKey, testUserId]
      );
      expect(check.rows[0].status).toBe("pending");
    });
  });
});
