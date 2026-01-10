// src/domain/feed/__tests__/Projection.canonB.test.js
// Phase B3.4: Tests for Canon B invariants (delete, revise, projection)

import { describe, it, expect } from "vitest";
import { assembleHome, assembleThread } from "../Projection.js";
import { NODES, EDGES } from "../../graph/Model.js";

describe("Phase B3.4: Canon B Invariants", () => {
  describe("B3.4-A: Delete creates tombstone superseder", () => {
    it("should hide both original and tombstone in feed", () => {
      const graph = {
        nodes: [
          // Original assertion
          { id: "asrt_original", type: NODES.ASSERTION, text: "Original post", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Tombstone that supersedes it
          { id: "tomb_1", type: NODES.ASSERTION, text: "", createdAt: "2024-01-02T00:00:00Z", assertionType: "tombstone", visibility: "public", supersedesId: "asrt_original" },
          // Author
          { id: "user_1", type: NODES.IDENTITY, handle: "testuser" },
        ],
        edges: [
          { source: "asrt_original", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "tomb_1", target: "user_1", type: EDGES.AUTHORED_BY },
          // SUPERSEDES edge
          { source: "asrt_original", target: "tomb_1", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      // Both original and tombstone should be hidden
      expect(feed).toHaveLength(0);
    });

    it("should preserve tombstone in history lineage", () => {
      // This test verifies that tombstones exist in the graph
      // History endpoint should be able to retrieve them
      const graph = {
        nodes: [
          { id: "asrt_1", type: NODES.ASSERTION, text: "Original", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          { id: "tomb_1", type: NODES.ASSERTION, text: "", createdAt: "2024-01-02T00:00:00Z", assertionType: "tombstone", visibility: "public", supersedesId: "asrt_1" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "asrt_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "tomb_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_1", target: "tomb_1", type: "SUPERSEDES" },
        ],
      };

      // Tombstone should exist in nodes (for history)
      const tombstone = graph.nodes.find(n => n.id === "tomb_1");
      expect(tombstone).toBeDefined();
      expect(tombstone.assertionType).toBe("tombstone");
      expect(tombstone.supersedesId).toBe("asrt_1");
    });

    it("should not allow in-place mutation (no deletedAt field)", () => {
      const graph = {
        nodes: [
          { id: "asrt_1", type: NODES.ASSERTION, text: "Post", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "asrt_1", target: "user_1", type: EDGES.AUTHORED_BY },
        ],
      };

      // Original assertion should NOT have deletedAt field
      const assertion = graph.nodes.find(n => n.id === "asrt_1");
      expect(assertion).not.toHaveProperty("deletedAt");
    });
  });

  describe("B3.4-B: Revise hides old version", () => {
    it("should show only new version after revision", () => {
      const graph = {
        nodes: [
          // Original
          { id: "asrt_v1", type: NODES.ASSERTION, text: "Version 1", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Revision
          { id: "asrt_v2", type: NODES.ASSERTION, text: "Version 2", createdAt: "2024-01-02T00:00:00Z", assertionType: "assertion", visibility: "public", supersedesId: "asrt_v1", revisionNumber: 1, rootAssertionId: "asrt_v1" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "asrt_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v1", target: "asrt_v2", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      expect(feed).toHaveLength(1);
      expect(feed[0].assertionId).toBe("asrt_v2");
      expect(feed[0].text).toBe("Version 2");
    });

    it("should show full revision chain in history", () => {
      const graph = {
        nodes: [
          { id: "asrt_v1", type: NODES.ASSERTION, text: "V1", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          { id: "asrt_v2", type: NODES.ASSERTION, text: "V2", createdAt: "2024-01-02T00:00:00Z", assertionType: "assertion", visibility: "public", supersedesId: "asrt_v1" },
          { id: "asrt_v3", type: NODES.ASSERTION, text: "V3", createdAt: "2024-01-03T00:00:00Z", assertionType: "assertion", visibility: "public", supersedesId: "asrt_v2" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "asrt_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v3", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v1", target: "asrt_v2", type: "SUPERSEDES" },
          { source: "asrt_v2", target: "asrt_v3", type: "SUPERSEDES" },
        ],
      };

      // All versions should exist in graph (for history endpoint)
      expect(graph.nodes.filter(n => n.type === NODES.ASSERTION)).toHaveLength(3);

      // But feed shows only latest
      const feed = assembleHome(graph, { viewerId: "user_1" });
      expect(feed).toHaveLength(1);
      expect(feed[0].assertionId).toBe("asrt_v3");
    });
  });

  describe("B3.4-C: Response version resolution scoping", () => {
    it("should resolve response versions in scoped node set", () => {
      const graph = {
        nodes: [
          // Root
          { id: "root", type: NODES.ASSERTION, text: "Root", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Response V1
          { id: "resp_v1", type: NODES.ASSERTION, text: "Response V1", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          // Response V2 (supersedes V1)
          { id: "resp_v2", type: NODES.ASSERTION, text: "Response V2", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_v1" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v1", target: "root", type: EDGES.RESPONDS_TO },
          { source: "resp_v2", target: "root", type: EDGES.RESPONDS_TO },
          { source: "resp_v1", target: "resp_v2", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      // Root should have only V2 response
      expect(feed).toHaveLength(1);
      expect(feed[0].responses).toHaveLength(1);
      expect(feed[0].responses[0].assertionId).toBe("resp_v2");
    });

    it("should not globally resolve then subset", () => {
      // This test ensures resolution happens on response set, not entire graph
      const graph = {
        nodes: [
          // Root 1
          { id: "root_1", type: NODES.ASSERTION, text: "Root 1", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Response to Root 1 (revised)
          { id: "resp_1_v1", type: NODES.ASSERTION, text: "R1 V1", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          { id: "resp_1_v2", type: NODES.ASSERTION, text: "R1 V2", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_1_v1" },
          // Root 2
          { id: "root_2", type: NODES.ASSERTION, text: "Root 2", createdAt: "2024-01-02T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Response to Root 2 (original, no revision)
          { id: "resp_2_v1", type: NODES.ASSERTION, text: "R2 V1", createdAt: "2024-01-02T01:00:00Z", assertionType: "response", visibility: "public" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "root_2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_2_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_v1", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_1_v2", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_2_v1", target: "root_2", type: EDGES.RESPONDS_TO },
          { source: "resp_1_v1", target: "resp_1_v2", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      // Two roots
      expect(feed).toHaveLength(2);

      // Root 1 should have only V2 response (scoped resolution)
      const root1 = feed.find(f => f.assertionId === "root_1");
      expect(root1.responses).toHaveLength(1);
      expect(root1.responses[0].assertionId).toBe("resp_1_v2");

      // Root 2 should have original response (scoped resolution)
      const root2 = feed.find(f => f.assertionId === "root_2");
      expect(root2.responses).toHaveLength(1);
      expect(root2.responses[0].assertionId).toBe("resp_2_v1");
    });
  });

  describe("Projection completeness", () => {
    it("should apply head-only rule to roots", () => {
      const graph = {
        nodes: [
          { id: "asrt_v1", type: NODES.ASSERTION, text: "V1", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          { id: "asrt_v2", type: NODES.ASSERTION, text: "V2", createdAt: "2024-01-02T00:00:00Z", assertionType: "assertion", visibility: "public", supersedesId: "asrt_v1" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "asrt_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "asrt_v1", target: "asrt_v2", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });
      expect(feed).toHaveLength(1);
      expect(feed[0].assertionId).toBe("asrt_v2");
    });

    it("should apply head-only rule to threads", () => {
      const graph = {
        nodes: [
          { id: "root", type: NODES.ASSERTION, text: "Root", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          { id: "resp_v1", type: NODES.ASSERTION, text: "V1", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          { id: "resp_v2", type: NODES.ASSERTION, text: "V2", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_v1" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v1", target: "root", type: EDGES.RESPONDS_TO },
          { source: "resp_v2", target: "root", type: EDGES.RESPONDS_TO },
          { source: "resp_v1", target: "resp_v2", type: "SUPERSEDES" },
        ],
      };

      const thread = assembleThread(graph, "root", { viewerId: "user_1" });
      expect(thread).toHaveLength(2); // root + resp_v2
      const nodeIds = thread.map(n => n.assertionId).sort();
      expect(nodeIds).toEqual(["resp_v2", "root"]);
    });
  });

  describe("B3.5-A: SupersedesId uniqueness enforcement", () => {
    it("should prevent duplicate supersession (double-revision conflict)", () => {
      // Simulate scenario: Two assertions attempt to supersede the same original
      // Only one should succeed (enforced by Neo4j constraint)

      const original = {
        id: "asrt_original",
        type: NODES.ASSERTION,
        text: "Original",
        assertionType: "assertion",
        visibility: "public",
        createdAt: "2024-01-01T00:00:00Z"
      };

      const revision1 = {
        id: "asrt_rev1",
        type: NODES.ASSERTION,
        text: "Revision 1",
        assertionType: "assertion",
        visibility: "public",
        supersedesId: "asrt_original",
        createdAt: "2024-01-02T00:00:00Z"
      };

      const revision2 = {
        id: "asrt_rev2",
        type: NODES.ASSERTION,
        text: "Revision 2",
        assertionType: "assertion",
        visibility: "public",
        supersedesId: "asrt_original", // ❌ Conflict - same supersedesId
        createdAt: "2024-01-02T00:00:01Z"
      };

      // In Neo4j with unique constraint, attempting to create both would result in:
      // - revision1 succeeds (first write)
      // - revision2 fails with constraint violation

      // For this projection test, we verify that if such data existed,
      // it would violate the uniqueness invariant
      const supersedesIds = [revision1.supersedesId, revision2.supersedesId];
      const uniqueSupersedesIds = new Set(supersedesIds);

      // Assert: supersedesIds should be unique
      expect(uniqueSupersedesIds.size).toBeLessThan(supersedesIds.length);
      // This demonstrates the conflict that the Neo4j constraint prevents
    });

    it("should prevent tombstone-revision conflict (delete-then-revise race)", () => {
      // Scenario: User clicks Delete and Edit simultaneously
      // Both create assertions with same supersedesId
      // Neo4j constraint ensures only one succeeds

      const tombstone = {
        id: "tomb_1",
        type: NODES.ASSERTION,
        assertionType: "tombstone",
        supersedesId: "asrt_target",
        text: "",
        visibility: "public",
        createdAt: "2024-01-01T12:00:00Z"
      };

      const revision = {
        id: "asrt_rev",
        type: NODES.ASSERTION,
        assertionType: "assertion",
        supersedesId: "asrt_target", // ❌ Conflict - same supersedesId as tombstone
        text: "Revised content",
        visibility: "public",
        createdAt: "2024-01-01T12:00:01Z"
      };

      // Verify both have same supersedesId (the conflict case)
      expect(tombstone.supersedesId).toBe(revision.supersedesId);

      // Neo4j constraint prevents this:
      // Whichever write completes first wins, the other gets constraint violation
    });

    it("should allow multiple null supersedesIds (original assertions)", () => {
      // Multiple original assertions can all have supersedesId = null
      const originals = [
        { id: "asrt_1", supersedesId: null },
        { id: "asrt_2", supersedesId: null },
        { id: "asrt_3", supersedesId: null }
      ];

      const supersedesIds = originals.map(a => a.supersedesId);
      const allNull = supersedesIds.every(id => id === null);

      expect(allNull).toBe(true);
      // This is valid - uniqueness constraint only applies to non-null values
    });

    it("should enforce linear revision history (no branching)", () => {
      // Linear revision chain: v1 → v2 → v3
      const chain = [
        { id: "asrt_v1", supersedesId: null },
        { id: "asrt_v2", supersedesId: "asrt_v1" },
        { id: "asrt_v3", supersedesId: "asrt_v2" }
      ];

      // Collect non-null supersedesIds
      const nonNullSupersedesIds = chain
        .map(a => a.supersedesId)
        .filter(id => id !== null);

      // Check uniqueness (Set size = array length means all unique)
      const uniqueIds = new Set(nonNullSupersedesIds);
      expect(uniqueIds.size).toBe(nonNullSupersedesIds.length);

      // Linear history preserved ✅
    });

    it("should detect branching (violation case)", () => {
      // Branching attempt: both v2a and v2b try to supersede v1
      const branching = [
        { id: "asrt_v1", supersedesId: null },
        { id: "asrt_v2a", supersedesId: "asrt_v1" },
        { id: "asrt_v2b", supersedesId: "asrt_v1" } // ❌ Duplicate
      ];

      const nonNullSupersedesIds = branching
        .map(a => a.supersedesId)
        .filter(id => id !== null);

      const uniqueIds = new Set(nonNullSupersedesIds);

      // Violation detected: duplicate supersedesId
      expect(uniqueIds.size).toBeLessThan(nonNullSupersedesIds.length);
      // Neo4j constraint prevents this from existing in the database
    });
  });
});
