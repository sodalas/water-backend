// src/infrastructure/graph/__tests__/schemaGuards.test.js
// Phase F.2 Work Items 2 & 3: Write-time guards and Identity normalization tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import neo4j from "neo4j-driver";
import { Neo4jGraphAdapter, ReplyToTombstonedError } from "../Neo4jGraphAdapter.js";

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

const adapter = new Neo4jGraphAdapter({
  uri: process.env.NEO4J_URI || "bolt://localhost:7687",
  user: process.env.NEO4J_USER || "neo4j",
  password: process.env.NEO4J_PASSWORD || "password",
});

describe("Phase F.2: Write-Time Guards", () => {
  const testPrefix = "f2_guard_test_";
  const testUserId = `${testPrefix}user_1`;
  const testUser2Id = `${testPrefix}user_2`;

  beforeEach(async () => {
    const session = driver.session();
    try {
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
      await session.run(
        `MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n`,
        { prefix: testPrefix }
      );
    } finally {
      await session.close();
    }
  });

  describe("T2: Reply-to-Tombstone Race Guard", () => {
    it("should allow reply to non-tombstoned assertion", async () => {
      // 1. Create root assertion
      const rootResult = await adapter.publish({
        viewer: { id: testUserId, handle: "testuser" },
        cso: {
          assertionType: "thought",
          text: "Root assertion",
          visibility: "public",
        },
      });

      const rootId = rootResult.assertionId;

      // 2. Create response to root (should succeed)
      const responseResult = await adapter.publish({
        viewer: { id: testUser2Id, handle: "responder" },
        cso: {
          assertionType: "response",
          text: "This is a reply",
          visibility: "public",
          refs: [{ uri: rootId }],
        },
      });

      expect(responseResult.assertionId).toBeDefined();

      // Verify response exists and links to root
      const session = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await session.run(
          `MATCH (r:Assertion {id: $responseId})-[:RESPONDS_TO]->(p:Assertion {id: $rootId})
           RETURN r, p`,
          { responseId: responseResult.assertionId, rootId }
        );
        expect(result.records.length).toBe(1);
      } finally {
        await session.close();
      }
    });

    it("should reject reply to tombstoned assertion", async () => {
      // 1. Create root assertion
      const rootResult = await adapter.publish({
        viewer: { id: testUserId, handle: "testuser" },
        cso: {
          assertionType: "thought",
          text: "Root to be deleted",
          visibility: "public",
        },
      });

      const rootId = rootResult.assertionId;

      // 2. Tombstone the root
      const deleteResult = await adapter.deleteAssertion(rootId, testUserId);
      expect(deleteResult.success).toBe(true);
      expect(deleteResult.tombstoneId).toBeDefined();

      // 3. Attempt to create response to tombstoned root (should fail)
      await expect(
        adapter.publish({
          viewer: { id: testUser2Id, handle: "responder" },
          cso: {
            assertionType: "response",
            text: "This reply should fail",
            visibility: "public",
            refs: [{ uri: rootId }],
          },
        })
      ).rejects.toThrow(ReplyToTombstonedError);
    });

    it("should reject reply to missing parent", async () => {
      const missingParentId = `${testPrefix}missing_parent`;

      await expect(
        adapter.publish({
          viewer: { id: testUserId, handle: "testuser" },
          cso: {
            assertionType: "response",
            text: "Reply to missing parent",
            visibility: "public",
            refs: [{ uri: missingParentId }],
          },
        })
      ).rejects.toThrow(ReplyToTombstonedError);
    });

    it("should not create response node when tombstone guard fails", async () => {
      // 1. Create and tombstone root
      const rootResult = await adapter.publish({
        viewer: { id: testUserId, handle: "testuser" },
        cso: {
          assertionType: "thought",
          text: "Root to be deleted",
          visibility: "public",
        },
      });

      const rootId = rootResult.assertionId;
      await adapter.deleteAssertion(rootId, testUserId);

      // 2. Count assertions before failed attempt
      const session = driver.session({ defaultAccessMode: neo4j.session.READ });
      let countBefore;
      try {
        const result = await session.run(
          `MATCH (a:Assertion) WHERE a.id STARTS WITH $prefix RETURN count(a) as count`,
          { prefix: testPrefix }
        );
        countBefore = result.records[0].get("count").toInt();
      } finally {
        await session.close();
      }

      // 3. Attempt failed reply
      try {
        await adapter.publish({
          viewer: { id: testUser2Id, handle: "responder" },
          cso: {
            assertionType: "response",
            text: "This reply should fail",
            visibility: "public",
            refs: [{ uri: rootId }],
          },
        });
      } catch (e) {
        // Expected
      }

      // 4. Verify no new assertion was created
      const sessionAfter = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await sessionAfter.run(
          `MATCH (a:Assertion) WHERE a.id STARTS WITH $prefix RETURN count(a) as count`,
          { prefix: testPrefix }
        );
        const countAfter = result.records[0].get("count").toInt();
        expect(countAfter).toBe(countBefore);
      } finally {
        await sessionAfter.close();
      }
    });
  });

  describe("T3: Identity Merge Consistency", () => {
    it("should create Identity with full properties on first publish", async () => {
      await adapter.publish({
        viewer: { id: testUserId, handle: "fullhandle", displayName: "Full Name" },
        cso: {
          assertionType: "thought",
          text: "First post",
          visibility: "public",
        },
      });

      const session = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await session.run(
          `MATCH (i:Identity {id: $id}) RETURN i`,
          { id: testUserId }
        );

        expect(result.records.length).toBe(1);
        const identity = result.records[0].get("i").properties;
        expect(identity.handle).toBe("fullhandle");
        expect(identity.displayName).toBe("Full Name");
      } finally {
        await session.close();
      }
    });

    it("should preserve existing properties when publishing without them", async () => {
      // 1. First publish with full properties
      await adapter.publish({
        viewer: { id: testUserId, handle: "initial_handle", displayName: "Initial Name" },
        cso: {
          assertionType: "thought",
          text: "First post",
          visibility: "public",
        },
      });

      // 2. Second publish without handle/displayName
      await adapter.publish({
        viewer: { id: testUserId },
        cso: {
          assertionType: "thought",
          text: "Second post",
          visibility: "public",
        },
      });

      // 3. Verify properties preserved
      const session = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await session.run(
          `MATCH (i:Identity {id: $id}) RETURN i`,
          { id: testUserId }
        );

        const identity = result.records[0].get("i").properties;
        expect(identity.handle).toBe("initial_handle");
        expect(identity.displayName).toBe("Initial Name");
      } finally {
        await session.close();
      }
    });

    it("should update properties when new values provided", async () => {
      // 1. First publish with initial properties
      await adapter.publish({
        viewer: { id: testUserId, handle: "old_handle", displayName: "Old Name" },
        cso: {
          assertionType: "thought",
          text: "First post",
          visibility: "public",
        },
      });

      // 2. Second publish with updated properties
      await adapter.publish({
        viewer: { id: testUserId, handle: "new_handle", displayName: "New Name" },
        cso: {
          assertionType: "thought",
          text: "Second post",
          visibility: "public",
        },
      });

      // 3. Verify properties updated
      const session = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await session.run(
          `MATCH (i:Identity {id: $id}) RETURN i`,
          { id: testUserId }
        );

        const identity = result.records[0].get("i").properties;
        expect(identity.handle).toBe("new_handle");
        expect(identity.displayName).toBe("New Name");
      } finally {
        await session.close();
      }
    });

    it("should enrich thin Identity created via reaction with publish data", async () => {
      // 1. Create a target assertion
      const targetResult = await adapter.publish({
        viewer: { id: testUser2Id, handle: "target_user" },
        cso: {
          assertionType: "thought",
          text: "Target post",
          visibility: "public",
        },
      });

      // 2. Add reaction (creates thin Identity for testUserId)
      await adapter.addReaction(testUserId, targetResult.assertionId, "like");

      // Verify thin identity exists (no handle/displayName)
      let sessionCheck = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await sessionCheck.run(
          `MATCH (i:Identity {id: $id}) RETURN i`,
          { id: testUserId }
        );
        expect(result.records.length).toBe(1);
        // Thin identity - may have null handle/displayName
      } finally {
        await sessionCheck.close();
      }

      // 3. Now publish with full properties
      await adapter.publish({
        viewer: { id: testUserId, handle: "enriched_handle", displayName: "Enriched Name" },
        cso: {
          assertionType: "thought",
          text: "My first post",
          visibility: "public",
        },
      });

      // 4. Verify Identity now has full properties
      const sessionAfter = driver.session({ defaultAccessMode: neo4j.session.READ });
      try {
        const result = await sessionAfter.run(
          `MATCH (i:Identity {id: $id}) RETURN i`,
          { id: testUserId }
        );

        const identity = result.records[0].get("i").properties;
        expect(identity.handle).toBe("enriched_handle");
        expect(identity.displayName).toBe("Enriched Name");
      } finally {
        await sessionAfter.close();
      }
    });
  });
});
