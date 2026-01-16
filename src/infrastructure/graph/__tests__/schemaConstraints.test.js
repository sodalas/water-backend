// src/infrastructure/graph/__tests__/schemaConstraints.test.js
// Phase F.2 Work Item 1: Schema constraint tests (T1)
// Tests for uniqueness constraints on Assertion.id, Identity.id, Topic.id

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

describe("Phase F.2: Schema Uniqueness Constraints", () => {
  const testPrefix = "f2_constraint_test_";

  beforeEach(async () => {
    const session = driver.session();
    try {
      // Clean up test data
      await session.run(
        `MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n`,
        { prefix: testPrefix }
      );
    } finally {
      await session.close();
    }
  });

  afterEach(async () => {
    const session = driver.session();
    try {
      // Clean up test data
      await session.run(
        `MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n`,
        { prefix: testPrefix }
      );
    } finally {
      await session.close();
    }
  });

  describe("Assertion.id uniqueness constraint", () => {
    it("should allow creating unique Assertion nodes", async () => {
      const session = driver.session();
      try {
        const id1 = `${testPrefix}asrt_1`;
        const id2 = `${testPrefix}asrt_2`;

        await session.run(
          `CREATE (a:Assertion {id: $id1, text: 'First'})`,
          { id1 }
        );

        await session.run(
          `CREATE (a:Assertion {id: $id2, text: 'Second'})`,
          { id2 }
        );

        const result = await session.run(
          `MATCH (a:Assertion) WHERE a.id IN [$id1, $id2] RETURN count(a) as count`,
          { id1, id2 }
        );

        expect(result.records[0].get("count").toInt()).toBe(2);
      } finally {
        await session.close();
      }
    });

    it("should reject duplicate Assertion.id with constraint error", async () => {
      const session = driver.session();
      try {
        const duplicateId = `${testPrefix}asrt_dup`;

        // Create first assertion
        await session.run(
          `CREATE (a:Assertion {id: $id, text: 'First'})`,
          { id: duplicateId }
        );

        // Attempt duplicate (should fail)
        await expect(
          session.run(
            `CREATE (a:Assertion {id: $id, text: 'Duplicate'})`,
            { id: duplicateId }
          )
        ).rejects.toThrow();
      } finally {
        await session.close();
      }
    });

    it("should throw ConstraintValidationFailed error code for duplicate Assertion.id", async () => {
      const session = driver.session();
      try {
        const duplicateId = `${testPrefix}asrt_dup_code`;

        await session.run(
          `CREATE (a:Assertion {id: $id, text: 'First'})`,
          { id: duplicateId }
        );

        try {
          await session.run(
            `CREATE (a:Assertion {id: $id, text: 'Duplicate'})`,
            { id: duplicateId }
          );
          expect.fail("Expected constraint violation error");
        } catch (error) {
          expect(error.code).toBe('Neo.ClientError.Schema.ConstraintValidationFailed');
        }
      } finally {
        await session.close();
      }
    });
  });

  describe("Identity.id uniqueness constraint", () => {
    it("should allow creating unique Identity nodes", async () => {
      const session = driver.session();
      try {
        const id1 = `${testPrefix}ident_1`;
        const id2 = `${testPrefix}ident_2`;

        await session.run(
          `CREATE (i:Identity {id: $id1, handle: 'user1'})`,
          { id1 }
        );

        await session.run(
          `CREATE (i:Identity {id: $id2, handle: 'user2'})`,
          { id2 }
        );

        const result = await session.run(
          `MATCH (i:Identity) WHERE i.id IN [$id1, $id2] RETURN count(i) as count`,
          { id1, id2 }
        );

        expect(result.records[0].get("count").toInt()).toBe(2);
      } finally {
        await session.close();
      }
    });

    it("should reject duplicate Identity.id with constraint error", async () => {
      const session = driver.session();
      try {
        const duplicateId = `${testPrefix}ident_dup`;

        // Create first identity
        await session.run(
          `CREATE (i:Identity {id: $id, handle: 'first'})`,
          { id: duplicateId }
        );

        // Attempt duplicate (should fail)
        await expect(
          session.run(
            `CREATE (i:Identity {id: $id, handle: 'duplicate'})`,
            { id: duplicateId }
          )
        ).rejects.toThrow();
      } finally {
        await session.close();
      }
    });

    it("should throw ConstraintValidationFailed error code for duplicate Identity.id", async () => {
      const session = driver.session();
      try {
        const duplicateId = `${testPrefix}ident_dup_code`;

        await session.run(
          `CREATE (i:Identity {id: $id, handle: 'first'})`,
          { id: duplicateId }
        );

        try {
          await session.run(
            `CREATE (i:Identity {id: $id, handle: 'duplicate'})`,
            { id: duplicateId }
          );
          expect.fail("Expected constraint violation error");
        } catch (error) {
          expect(error.code).toBe('Neo.ClientError.Schema.ConstraintValidationFailed');
        }
      } finally {
        await session.close();
      }
    });

    it("should allow MERGE (idempotent) on Identity.id", async () => {
      const session = driver.session();
      try {
        const identityId = `${testPrefix}ident_merge`;

        // First MERGE
        await session.run(
          `MERGE (i:Identity {id: $id}) SET i.handle = 'initial'`,
          { id: identityId }
        );

        // Second MERGE (should succeed, not fail)
        await session.run(
          `MERGE (i:Identity {id: $id}) SET i.displayName = 'Added Name'`,
          { id: identityId }
        );

        const result = await session.run(
          `MATCH (i:Identity {id: $id}) RETURN i`,
          { id: identityId }
        );

        expect(result.records.length).toBe(1);
        expect(result.records[0].get("i").properties.handle).toBe("initial");
        expect(result.records[0].get("i").properties.displayName).toBe("Added Name");
      } finally {
        await session.close();
      }
    });
  });

  describe("Topic.id uniqueness constraint", () => {
    it("should allow creating unique Topic nodes", async () => {
      const session = driver.session();
      try {
        const id1 = `${testPrefix}topic_1`;
        const id2 = `${testPrefix}topic_2`;

        await session.run(
          `CREATE (t:Topic {id: $id1})`,
          { id1 }
        );

        await session.run(
          `CREATE (t:Topic {id: $id2})`,
          { id2 }
        );

        const result = await session.run(
          `MATCH (t:Topic) WHERE t.id IN [$id1, $id2] RETURN count(t) as count`,
          { id1, id2 }
        );

        expect(result.records[0].get("count").toInt()).toBe(2);
      } finally {
        await session.close();
      }
    });

    it("should reject duplicate Topic.id with constraint error", async () => {
      const session = driver.session();
      try {
        const duplicateId = `${testPrefix}topic_dup`;

        // Create first topic
        await session.run(
          `CREATE (t:Topic {id: $id})`,
          { id: duplicateId }
        );

        // Attempt duplicate (should fail)
        await expect(
          session.run(
            `CREATE (t:Topic {id: $id})`,
            { id: duplicateId }
          )
        ).rejects.toThrow();
      } finally {
        await session.close();
      }
    });
  });
});
