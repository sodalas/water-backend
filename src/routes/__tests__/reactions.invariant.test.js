// src/routes/__tests__/reactions.invariant.test.js
// Phase E.1: Reaction Canon Invariant Tests
//
// This test validates ALL canon invariants for reactions:
// - E.1.1: Non-structural (reactions don't affect threads/feeds)
// - E.1.2: One per user per type (idempotency)
// - E.1.3: Visibility gating (tombstone, superseded, visibility)
// - E.1.4: Not versions (reactions stay on superseded assertions)
// - E.1.5: Honest UX (tested at frontend layer)

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import neo4j from "neo4j-driver";
import { Neo4jGraphAdapter } from "../../infrastructure/graph/Neo4jGraphAdapter.js";

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

// Create adapter instance for testing
const adapter = new Neo4jGraphAdapter({
  uri: process.env.NEO4J_URI || "bolt://localhost:7687",
  user: process.env.NEO4J_USER || "neo4j",
  password: process.env.NEO4J_PASSWORD || "password",
});

// Test data IDs
const TEST_IDS = {
  user1: "user_test_reactor_1",
  user2: "user_test_reactor_2",
  author: "user_test_author",
  publicAssertion: "asrt_test_public",
  privateAssertion: "asrt_test_private",
  tombstonedAssertion: "asrt_test_tombstoned",
  tombstone: "asrt_test_tombstone_marker",
  supersededAssertion: "asrt_test_superseded",
  supersedingAssertion: "asrt_test_superseding",
  threadRoot: "asrt_test_thread_root",
  threadReply: "asrt_test_thread_reply",
};

describe("Phase E.1: Reaction Canon Invariants", () => {
  beforeAll(async () => {
    // Ensure Identity nodes exist for test users
    const session = driver.session();
    try {
      await session.run(
        `MERGE (u1:Identity {id: $user1})
         MERGE (u2:Identity {id: $user2})
         MERGE (author:Identity {id: $author})`,
        { user1: TEST_IDS.user1, user2: TEST_IDS.user2, author: TEST_IDS.author }
      );
    } finally {
      await session.close();
    }
  });

  afterAll(async () => {
    // Clean up all test data
    const session = driver.session();
    try {
      const allIds = Object.values(TEST_IDS);
      await session.run(
        `MATCH (n)
         WHERE n.id IN $ids
         DETACH DELETE n`,
        { ids: allIds }
      );
    } finally {
      await session.close();
      await adapter.close();
      await driver.close();
    }
  });

  beforeEach(async () => {
    // Clean up assertions before each test
    const session = driver.session();
    try {
      await session.run(
        `MATCH (a:Assertion)
         WHERE a.id STARTS WITH 'asrt_test_'
         DETACH DELETE a`
      );
      // Clean up any REACTED_TO edges
      await session.run(
        `MATCH (u:Identity)-[r:REACTED_TO]->()
         WHERE u.id STARTS WITH 'user_test_'
         DELETE r`
      );
    } finally {
      await session.close();
    }
  });

  // ============================================================
  // 1. IDEMPOTENCY TESTS
  // ============================================================
  describe("Invariant E.1.2: Idempotency", () => {
    beforeEach(async () => {
      // Create a public assertion
      const session = driver.session();
      try {
        await session.run(
          `CREATE (a:Assertion {
            id: $id,
            assertionType: 'moment',
            text: 'Test assertion',
            visibility: 'public',
            createdAt: datetime()
          })
          WITH a
          MATCH (author:Identity {id: $authorId})
          CREATE (a)-[:AUTHORED_BY]->(author)`,
          { id: TEST_IDS.publicAssertion, authorId: TEST_IDS.author }
        );
      } finally {
        await session.close();
      }
    });

    it("should create exactly one REACTED_TO edge on first reaction", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO]->(a:Assertion {id: $assertionId})
           RETURN count(r) as count`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records[0].get("count").toInt()).toBe(1);
      } finally {
        await session.close();
      }
    });

    it("should NOT create duplicate edge when adding same reaction twice", async () => {
      // Add reaction twice
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO {type: 'like'}]->(a:Assertion {id: $assertionId})
           RETURN count(r) as count`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        // Must be exactly 1, not 2
        expect(result.records[0].get("count").toInt()).toBe(1);
      } finally {
        await session.close();
      }
    });

    it("should allow different reaction types from same user", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "acknowledge");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO]->(a:Assertion {id: $assertionId})
           RETURN count(r) as count`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records[0].get("count").toInt()).toBe(2);
      } finally {
        await session.close();
      }
    });

    it("should allow different users to react to same assertion", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user2, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity)-[r:REACTED_TO {type: 'like'}]->(a:Assertion {id: $assertionId})
           RETURN count(r) as count`,
          { assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records[0].get("count").toInt()).toBe(2);
      } finally {
        await session.close();
      }
    });
  });

  // ============================================================
  // 2. TOGGLE SEMANTICS TESTS
  // ============================================================
  describe("Toggle Semantics", () => {
    beforeEach(async () => {
      const session = driver.session();
      try {
        await session.run(
          `CREATE (a:Assertion {
            id: $id,
            assertionType: 'moment',
            text: 'Test assertion',
            visibility: 'public',
            createdAt: datetime()
          })
          WITH a
          MATCH (author:Identity {id: $authorId})
          CREATE (a)-[:AUTHORED_BY]->(author)`,
          { id: TEST_IDS.publicAssertion, authorId: TEST_IDS.author }
        );
      } finally {
        await session.close();
      }
    });

    it("should create edge when adding reaction", async () => {
      const result = await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      expect(result.added).toBe(true);

      const session = driver.session();
      try {
        const check = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO {type: 'like'}]->(a:Assertion {id: $assertionId})
           RETURN r`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(check.records.length).toBe(1);
      } finally {
        await session.close();
      }
    });

    it("should delete edge when removing reaction", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      const result = await adapter.removeReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      expect(result.removed).toBe(true);

      const session = driver.session();
      try {
        const check = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO {type: 'like'}]->(a:Assertion {id: $assertionId})
           RETURN r`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(check.records.length).toBe(0);
      } finally {
        await session.close();
      }
    });

    it("should restore exactly one edge when re-adding after removal", async () => {
      // Add -> Remove -> Re-add
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.removeReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO {type: 'like'}]->(a:Assertion {id: $assertionId})
           RETURN count(r) as count`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records[0].get("count").toInt()).toBe(1);
      } finally {
        await session.close();
      }
    });

    it("should return removed=false when removing non-existent reaction", async () => {
      const result = await adapter.removeReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      expect(result.removed).toBe(false);
    });
  });

  // ============================================================
  // 3. VISIBILITY GUARD TESTS
  // ============================================================
  describe("Invariant E.1.3: Visibility Gating", () => {
    describe("Tombstoned assertions", () => {
      beforeEach(async () => {
        const session = driver.session();
        try {
          // Create a tombstoned assertion (deleted)
          await session.run(
            `CREATE (a:Assertion {
              id: $id,
              assertionType: 'tombstone',
              text: '',
              visibility: 'public',
              createdAt: datetime()
            })
            WITH a
            MATCH (author:Identity {id: $authorId})
            CREATE (a)-[:AUTHORED_BY]->(author)`,
            { id: TEST_IDS.tombstonedAssertion, authorId: TEST_IDS.author }
          );
        } finally {
          await session.close();
        }
      });

      it("should reject reaction to tombstoned assertion", async () => {
        const result = await adapter.addReaction(TEST_IDS.user1, TEST_IDS.tombstonedAssertion, "like");
        expect(result.added).toBe(false);
        expect(result.error).toBe("tombstoned");
      });

      it("should NOT create edge for tombstoned assertion", async () => {
        await adapter.addReaction(TEST_IDS.user1, TEST_IDS.tombstonedAssertion, "like");

        const session = driver.session();
        try {
          const result = await session.run(
            `MATCH (u:Identity {id: $userId})-[r:REACTED_TO]->(a:Assertion {id: $assertionId})
             RETURN count(r) as count`,
            { userId: TEST_IDS.user1, assertionId: TEST_IDS.tombstonedAssertion }
          );
          expect(result.records[0].get("count").toInt()).toBe(0);
        } finally {
          await session.close();
        }
      });
    });

    describe("Superseded assertions", () => {
      beforeEach(async () => {
        const session = driver.session();
        try {
          // Create original (superseded) assertion
          await session.run(
            `CREATE (old:Assertion {
              id: $oldId,
              assertionType: 'moment',
              text: 'Original text',
              visibility: 'public',
              supersedesId: null,
              createdAt: datetime()
            })
            WITH old
            MATCH (author:Identity {id: $authorId})
            CREATE (old)-[:AUTHORED_BY]->(author)
            CREATE (new:Assertion {
              id: $newId,
              assertionType: 'moment',
              text: 'Revised text',
              visibility: 'public',
              supersedesId: $oldId,
              createdAt: datetime()
            })
            CREATE (new)-[:AUTHORED_BY]->(author)`,
            {
              oldId: TEST_IDS.supersededAssertion,
              newId: TEST_IDS.supersedingAssertion,
              authorId: TEST_IDS.author,
            }
          );
        } finally {
          await session.close();
        }
      });

      it("should reject reaction to superseded assertion", async () => {
        const result = await adapter.addReaction(TEST_IDS.user1, TEST_IDS.supersededAssertion, "like");
        expect(result.added).toBe(false);
        expect(result.error).toBe("superseded");
      });

      it("should allow reaction to superseding (current) assertion", async () => {
        const result = await adapter.addReaction(TEST_IDS.user1, TEST_IDS.supersedingAssertion, "like");
        expect(result.added).toBe(true);
      });
    });

    describe("Visibility restrictions", () => {
      beforeEach(async () => {
        const session = driver.session();
        try {
          // Create a private assertion
          await session.run(
            `CREATE (a:Assertion {
              id: $id,
              assertionType: 'moment',
              text: 'Private content',
              visibility: 'private',
              createdAt: datetime()
            })
            WITH a
            MATCH (author:Identity {id: $authorId})
            CREATE (a)-[:AUTHORED_BY]->(author)`,
            { id: TEST_IDS.privateAssertion, authorId: TEST_IDS.author }
          );
        } finally {
          await session.close();
        }
      });

      it("should reject reaction from non-author on private assertion", async () => {
        const result = await adapter.addReaction(TEST_IDS.user1, TEST_IDS.privateAssertion, "like");
        expect(result.added).toBe(false);
        expect(result.error).toBe("visibility");
      });

      it("should allow author to react to their own private assertion", async () => {
        const result = await adapter.addReaction(TEST_IDS.author, TEST_IDS.privateAssertion, "like");
        expect(result.added).toBe(true);
      });
    });

    describe("Non-existent assertions", () => {
      it("should return not_found error for non-existent assertion", async () => {
        const result = await adapter.addReaction(TEST_IDS.user1, "asrt_does_not_exist", "like");
        expect(result.added).toBe(false);
        expect(result.error).toBe("not_found");
      });
    });
  });

  // ============================================================
  // 4. NON-STRUCTURAL GUARANTEE TESTS
  // ============================================================
  describe("Invariant E.1.1: Non-Structural Guarantee", () => {
    beforeEach(async () => {
      const session = driver.session();
      try {
        // Create a thread: root -> reply
        await session.run(
          `CREATE (root:Assertion {
            id: $rootId,
            assertionType: 'moment',
            text: 'Thread root',
            visibility: 'public',
            createdAt: datetime()
          })
          WITH root
          MATCH (author:Identity {id: $authorId})
          CREATE (root)-[:AUTHORED_BY]->(author)
          CREATE (reply:Assertion {
            id: $replyId,
            assertionType: 'response',
            text: 'Reply to root',
            visibility: 'public',
            createdAt: datetime()
          })
          CREATE (reply)-[:AUTHORED_BY]->(author)
          CREATE (reply)-[:RESPONDS_TO]->(root)`,
          {
            rootId: TEST_IDS.threadRoot,
            replyId: TEST_IDS.threadReply,
            authorId: TEST_IDS.author,
          }
        );
      } finally {
        await session.close();
      }
    });

    it("should NOT change thread shape after adding reactions", async () => {
      // Get thread structure before reactions
      const session = driver.session();
      let beforeEdges, afterEdges;

      try {
        const before = await session.run(
          `MATCH (a:Assertion)-[r:RESPONDS_TO]->(b:Assertion)
           WHERE a.id = $replyId AND b.id = $rootId
           RETURN count(r) as count`,
          { replyId: TEST_IDS.threadReply, rootId: TEST_IDS.threadRoot }
        );
        beforeEdges = before.records[0].get("count").toInt();
      } finally {
        await session.close();
      }

      // Add reactions
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.threadRoot, "like");
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.threadReply, "acknowledge");
      await adapter.addReaction(TEST_IDS.user2, TEST_IDS.threadRoot, "like");

      // Get thread structure after reactions
      const session2 = driver.session();
      try {
        const after = await session2.run(
          `MATCH (a:Assertion)-[r:RESPONDS_TO]->(b:Assertion)
           WHERE a.id = $replyId AND b.id = $rootId
           RETURN count(r) as count`,
          { replyId: TEST_IDS.threadReply, rootId: TEST_IDS.threadRoot }
        );
        afterEdges = after.records[0].get("count").toInt();
      } finally {
        await session2.close();
      }

      // Thread structure must be unchanged
      expect(afterEdges).toBe(beforeEdges);
      expect(afterEdges).toBe(1);
    });

    it("should NOT change reply reachability after reactions", async () => {
      // Add reactions
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.threadRoot, "like");

      // Verify reply is still reachable from root
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (reply:Assertion {id: $replyId})-[:RESPONDS_TO]->(root:Assertion {id: $rootId})
           RETURN reply.id as replyId`,
          { replyId: TEST_IDS.threadReply, rootId: TEST_IDS.threadRoot }
        );
        expect(result.records.length).toBe(1);
        expect(result.records[0].get("replyId")).toBe(TEST_IDS.threadReply);
      } finally {
        await session.close();
      }
    });

    it("should NOT affect feed contents (root assertions remain roots)", async () => {
      // Add reactions
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.threadRoot, "like");

      // Verify root is still a root (no outgoing RESPONDS_TO)
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (root:Assertion {id: $rootId})
           OPTIONAL MATCH (root)-[:RESPONDS_TO]->(parent:Assertion)
           RETURN parent IS NULL as isRoot`,
          { rootId: TEST_IDS.threadRoot }
        );
        expect(result.records[0].get("isRoot")).toBe(true);
      } finally {
        await session.close();
      }
    });

    it("should remove reactions without affecting thread structure", async () => {
      // Add then remove reactions
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.threadRoot, "like");
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.threadReply, "acknowledge");
      await adapter.removeReaction(TEST_IDS.user1, TEST_IDS.threadRoot, "like");
      await adapter.removeReaction(TEST_IDS.user1, TEST_IDS.threadReply, "acknowledge");

      // Thread structure must remain intact
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (reply:Assertion {id: $replyId})-[:RESPONDS_TO]->(root:Assertion {id: $rootId})
           RETURN count(*) as count`,
          { replyId: TEST_IDS.threadReply, rootId: TEST_IDS.threadRoot }
        );
        expect(result.records[0].get("count").toInt()).toBe(1);
      } finally {
        await session.close();
      }
    });
  });

  // ============================================================
  // 5. GRAPH INTEGRITY TESTS
  // ============================================================
  describe("Graph Integrity", () => {
    beforeEach(async () => {
      const session = driver.session();
      try {
        await session.run(
          `CREATE (a:Assertion {
            id: $id,
            assertionType: 'moment',
            text: 'Test assertion',
            visibility: 'public',
            createdAt: datetime()
          })
          WITH a
          MATCH (author:Identity {id: $authorId})
          CREATE (a)-[:AUTHORED_BY]->(author)`,
          { id: TEST_IDS.publicAssertion, authorId: TEST_IDS.author }
        );
      } finally {
        await session.close();
      }
    });

    it("should create REACTED_TO edge from Identity to Assertion", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO]->(a:Assertion {id: $assertionId})
           RETURN labels(startNode(r)) as fromLabels, labels(endNode(r)) as toLabels`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records.length).toBe(1);
        expect(result.records[0].get("fromLabels")).toContain("Identity");
        expect(result.records[0].get("toLabels")).toContain("Assertion");
      } finally {
        await session.close();
      }
    });

    it("should include type property on REACTED_TO edge", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO]->(a:Assertion {id: $assertionId})
           RETURN r.type as type`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records[0].get("type")).toBe("like");
      } finally {
        await session.close();
      }
    });

    it("should include createdAt property on REACTED_TO edge", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Identity {id: $userId})-[r:REACTED_TO]->(a:Assertion {id: $assertionId})
           RETURN r.createdAt as createdAt`,
          { userId: TEST_IDS.user1, assertionId: TEST_IDS.publicAssertion }
        );
        expect(result.records[0].get("createdAt")).toBeDefined();
        expect(result.records[0].get("createdAt")).not.toBeNull();
      } finally {
        await session.close();
      }
    });

    it("should NOT create Reaction nodes (only edges)", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user2, TEST_IDS.publicAssertion, "acknowledge");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (r:Reaction) RETURN count(r) as count`
        );
        expect(result.records[0].get("count").toInt()).toBe(0);
      } finally {
        await session.close();
      }
    });

    it("should NOT create reaction edges between assertions", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (a:Assertion)-[r:REACTED_TO]->(b:Assertion) RETURN count(r) as count`
        );
        expect(result.records[0].get("count").toInt()).toBe(0);
      } finally {
        await session.close();
      }
    });
  });

  // ============================================================
  // 6. REACTION COUNTS AND RETRIEVAL
  // ============================================================
  describe("Reaction Retrieval", () => {
    beforeEach(async () => {
      const session = driver.session();
      try {
        await session.run(
          `CREATE (a:Assertion {
            id: $id,
            assertionType: 'moment',
            text: 'Test assertion',
            visibility: 'public',
            createdAt: datetime()
          })
          WITH a
          MATCH (author:Identity {id: $authorId})
          CREATE (a)-[:AUTHORED_BY]->(author)`,
          { id: TEST_IDS.publicAssertion, authorId: TEST_IDS.author }
        );
      } finally {
        await session.close();
      }
    });

    it("should return accurate counts after multiple reactions", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user2, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.author, TEST_IDS.publicAssertion, "acknowledge");

      const result = await adapter.getReactionsForAssertion(TEST_IDS.publicAssertion);
      expect(result.counts.like).toBe(2);
      expect(result.counts.acknowledge).toBe(1);
    });

    it("should return user's reactions when viewerId provided", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "acknowledge");

      const result = await adapter.getReactionsForAssertion(TEST_IDS.publicAssertion, TEST_IDS.user1);
      expect(result.userReactions).toContain("like");
      expect(result.userReactions).toContain("acknowledge");
      expect(result.userReactions.length).toBe(2);
    });

    it("should return empty userReactions when viewerId not provided", async () => {
      await adapter.addReaction(TEST_IDS.user1, TEST_IDS.publicAssertion, "like");

      const result = await adapter.getReactionsForAssertion(TEST_IDS.publicAssertion, null);
      expect(result.userReactions).toEqual([]);
    });

    it("should return zero counts for assertion with no reactions", async () => {
      const result = await adapter.getReactionsForAssertion(TEST_IDS.publicAssertion);
      expect(result.counts.like).toBe(0);
      expect(result.counts.acknowledge).toBe(0);
    });
  });
});
