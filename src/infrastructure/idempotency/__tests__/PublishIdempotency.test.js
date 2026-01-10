// src/infrastructure/idempotency/__tests__/PublishIdempotency.test.js
// Temporal Invariant A: Idempotent publish tests

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPublishByIdempotencyKey, recordPublishIdempotency } from "../PublishIdempotency.js";
import { pool } from "../../../db.js";

describe("Temporal Invariant A: Idempotent Publish", () => {
  const testUserId = "user_test_123";
  const testIdempotencyKey = "idem_test_abc";
  const testAssertionId = "asrt_test_xyz";

  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM publish_idempotency WHERE user_id = $1", [testUserId]);
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM publish_idempotency WHERE user_id = $1", [testUserId]);
  });

  describe("recordPublishIdempotency", () => {
    it("should record a new idempotency key", async () => {
      await recordPublishIdempotency(testIdempotencyKey, testUserId, testAssertionId);

      const result = await getPublishByIdempotencyKey(testIdempotencyKey, testUserId);
      expect(result).not.toBeNull();
      expect(result.assertionId).toBe(testAssertionId);
    });

    it("should ignore duplicate idempotency key (ON CONFLICT DO NOTHING)", async () => {
      await recordPublishIdempotency(testIdempotencyKey, testUserId, testAssertionId);
      await recordPublishIdempotency(testIdempotencyKey, testUserId, "asrt_different");

      const result = await getPublishByIdempotencyKey(testIdempotencyKey, testUserId);
      expect(result).not.toBeNull();
      expect(result.assertionId).toBe(testAssertionId); // Should still be original
    });
  });

  describe("getPublishByIdempotencyKey", () => {
    it("should return null for non-existent key", async () => {
      const result = await getPublishByIdempotencyKey("nonexistent_key", testUserId);
      expect(result).toBeNull();
    });

    it("should return assertion for existing key", async () => {
      await recordPublishIdempotency(testIdempotencyKey, testUserId, testAssertionId);

      const result = await getPublishByIdempotencyKey(testIdempotencyKey, testUserId);
      expect(result).not.toBeNull();
      expect(result.assertionId).toBe(testAssertionId);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("should not return expired keys", async () => {
      // Insert with past expiration
      await pool.query(
        `INSERT INTO publish_idempotency (idempotency_key, user_id, assertion_id, expires_at)
         VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour')`,
        [testIdempotencyKey, testUserId, testAssertionId]
      );

      const result = await getPublishByIdempotencyKey(testIdempotencyKey, testUserId);
      expect(result).toBeNull();
    });

    it("should scope keys by user_id", async () => {
      const otherUserId = "user_other_456";
      await recordPublishIdempotency(testIdempotencyKey, testUserId, testAssertionId);

      // Same key, different user
      const result = await getPublishByIdempotencyKey(testIdempotencyKey, otherUserId);
      expect(result).toBeNull();
    });
  });

  describe("Idempotency replay behavior", () => {
    it("should allow same request to replay successfully", async () => {
      // First publish
      await recordPublishIdempotency(testIdempotencyKey, testUserId, testAssertionId);

      // Second publish attempt with same key (simulating retry)
      const existing = await getPublishByIdempotencyKey(testIdempotencyKey, testUserId);

      expect(existing).not.toBeNull();
      expect(existing.assertionId).toBe(testAssertionId);
      // In route handler, this would return 200 with { assertionId, replayed: true }
    });
  });
});
