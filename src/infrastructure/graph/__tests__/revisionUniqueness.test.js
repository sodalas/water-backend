// src/infrastructure/graph/__tests__/revisionUniqueness.test.js
// Temporal Invariant B: Revision uniqueness constraint tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

describe("Temporal Invariant B: Revision Uniqueness", () => {
  const testAssertionId1 = "asrt_test_original";
  const testAssertionId2 = "asrt_test_revision1";
  const testAssertionId3 = "asrt_test_revision2";

  beforeEach(async () => {
    const session = driver.session();
    try {
      // Clean up test data
      await session.run(
        `MATCH (a:Assertion)
         WHERE a.id IN [$id1, $id2, $id3]
         DETACH DELETE a`,
        { id1: testAssertionId1, id2: testAssertionId2, id3: testAssertionId3 }
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
        `MATCH (a:Assertion)
         WHERE a.id IN [$id1, $id2, $id3]
         DETACH DELETE a`,
        { id1: testAssertionId1, id2: testAssertionId2, id3: testAssertionId3 }
      );
    } finally {
      await session.close();
    }
  });

  it("should allow creating an original assertion (supersedesId = null)", async () => {
    const session = driver.session();
    try {
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: null,
          text: 'Original assertion'
        })`,
        { id: testAssertionId1 }
      );

      const result = await session.run(
        `MATCH (a:Assertion {id: $id}) RETURN a`,
        { id: testAssertionId1 }
      );

      expect(result.records.length).toBe(1);
    } finally {
      await session.close();
    }
  });

  it("should allow first revision of an assertion", async () => {
    const session = driver.session();
    try {
      // Create original
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: null,
          text: 'Original assertion'
        })`,
        { id: testAssertionId1 }
      );

      // Create first revision
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: $supersedesId,
          text: 'First revision'
        })`,
        { id: testAssertionId2, supersedesId: testAssertionId1 }
      );

      const result = await session.run(
        `MATCH (a:Assertion {id: $id}) RETURN a`,
        { id: testAssertionId2 }
      );

      expect(result.records.length).toBe(1);
      expect(result.records[0].get("a").properties.supersedesId).toBe(testAssertionId1);
    } finally {
      await session.close();
    }
  });

  it("should reject second revision of same assertion (uniqueness constraint)", async () => {
    const session = driver.session();
    try {
      // Create original
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: null,
          text: 'Original assertion'
        })`,
        { id: testAssertionId1 }
      );

      // Create first revision
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: $supersedesId,
          text: 'First revision'
        })`,
        { id: testAssertionId2, supersedesId: testAssertionId1 }
      );

      // Attempt second revision (should fail with constraint error)
      await expect(
        session.run(
          `CREATE (a:Assertion {
            id: $id,
            supersedesId: $supersedesId,
            text: 'Second revision (should fail)'
          })`,
          { id: testAssertionId3, supersedesId: testAssertionId1 }
        )
      ).rejects.toThrow();
    } finally {
      await session.close();
    }
  });

  it("should throw Neo4j constraint error with specific error code", async () => {
    const session = driver.session();
    try {
      // Create original
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: null,
          text: 'Original assertion'
        })`,
        { id: testAssertionId1 }
      );

      // Create first revision
      await session.run(
        `CREATE (a:Assertion {
          id: $id,
          supersedesId: $supersedesId,
          text: 'First revision'
        })`,
        { id: testAssertionId2, supersedesId: testAssertionId1 }
      );

      // Attempt second revision and verify error code
      try {
        await session.run(
          `CREATE (a:Assertion {
            id: $id,
            supersedesId: $supersedesId,
            text: 'Second revision (should fail)'
          })`,
          { id: testAssertionId3, supersedesId: testAssertionId1 }
        );
        // Should not reach here
        expect.fail("Expected constraint violation error");
      } catch (error) {
        // Bolt-Tightener 2: Verify error code for 409 mapping
        expect(error.code).toBe('Neo.ClientError.Schema.ConstraintValidationFailed');
      }
    } finally {
      await session.close();
    }
  });

  it("should allow multiple original assertions (all with supersedesId = null)", async () => {
    const session = driver.session();
    try {
      await session.run(
        `CREATE (a1:Assertion {
          id: $id1,
          supersedesId: null,
          text: 'Original 1'
        }),
        (a2:Assertion {
          id: $id2,
          supersedesId: null,
          text: 'Original 2'
        })`,
        { id1: testAssertionId1, id2: testAssertionId2 }
      );

      const result = await session.run(
        `MATCH (a:Assertion)
         WHERE a.id IN [$id1, $id2]
         RETURN count(a) as count`,
        { id1: testAssertionId1, id2: testAssertionId2 }
      );

      expect(result.records[0].get("count").toInt()).toBe(2);
    } finally {
      await session.close();
    }
  });
});
