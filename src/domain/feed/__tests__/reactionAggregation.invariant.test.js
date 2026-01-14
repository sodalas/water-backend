// src/domain/feed/__tests__/reactionAggregation.invariant.test.js
// Phase: Reaction Aggregation Invariant Tests
//
// Per CONTRACTS.md §3.2 and TASKS.md:
// - Aggregation is read-only
// - Aggregation must not affect ordering, visibility, or prominence
// - Roots and replies are treated symmetrically
// - Removing reactions does not alter content semantics
// - Counts must be neutral and non-emphasized
// - No sorting, weighting, or heuristics derived from reactions

import { describe, it, expect } from "vitest";
import { assembleHome, assembleThread, assembleProfile } from "../Projection.js";
import { EDGES, NODES } from "../../graph/Model.js";

// Helper to create a minimal assertion node
function createAssertion(id, createdAt, visibility = "public", assertionType = "moment") {
  return {
    id,
    type: NODES.ASSERTION,
    assertionType,
    text: `Test assertion ${id}`,
    createdAt,
    visibility,
    media: [],
  };
}

// Helper to create identity node
function createIdentity(id) {
  return {
    id,
    type: NODES.IDENTITY,
    handle: `@${id}`,
    displayName: `User ${id}`,
  };
}

describe("Reaction Aggregation Invariants (CONTRACTS.md §3.2)", () => {
  // ============================================================
  // INVARIANT: Aggregation must not affect ordering
  // ============================================================
  describe("Ordering Independence", () => {
    it("feed order is strictly chronological regardless of reaction counts", () => {
      // Create assertions with different timestamps
      const nodes = [
        createAssertion("asrt_old", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_new", "2024-01-02T00:00:00Z"),
        createIdentity("user_author"),
        createIdentity("user_reactor"),
      ];

      // Old assertion has MORE reactions than new assertion
      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_old", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_new", target: "user_author" },
        // Old assertion: 10 likes
        ...Array.from({ length: 10 }, () => ({
          type: EDGES.REACTED_TO,
          target: "asrt_old",
          reactionType: "like",
        })),
        // New assertion: 1 like
        { type: EDGES.REACTED_TO, target: "asrt_new", reactionType: "like" },
      ];

      const feed = assembleHome({ nodes, edges }, { viewerId: null });

      // INVARIANT: Newer assertion MUST be first (chronological desc)
      // Despite having fewer reactions
      expect(feed[0].assertionId).toBe("asrt_new");
      expect(feed[1].assertionId).toBe("asrt_old");

      // Verify counts are correct but didn't affect order
      expect(feed[0].reactionCounts.like).toBe(1);
      expect(feed[1].reactionCounts.like).toBe(10);
    });

    it("thread order is strictly chronological regardless of reaction counts", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply1", "2024-01-01T01:00:00Z", "public", "response"),
        createAssertion("asrt_reply2", "2024-01-01T02:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply1", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply2", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply1", target: "asrt_root" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply2", target: "asrt_root" },
        // reply1 has MORE reactions than reply2
        ...Array.from({ length: 5 }, () => ({
          type: EDGES.REACTED_TO,
          target: "asrt_reply1",
          reactionType: "like",
        })),
        { type: EDGES.REACTED_TO, target: "asrt_reply2", reactionType: "like" },
      ];

      const thread = assembleThread({ nodes, edges }, "asrt_root", { viewerId: null });

      // INVARIANT: Thread order is chronological (oldest first)
      // Despite reply1 having more reactions, reply2 comes after (newer)
      expect(thread[0].assertionId).toBe("asrt_root");
      expect(thread[1].assertionId).toBe("asrt_reply1");
      expect(thread[2].assertionId).toBe("asrt_reply2");
    });
  });

  // ============================================================
  // INVARIANT: Aggregation must not affect visibility
  // ============================================================
  describe("Visibility Independence", () => {
    it("private assertions remain invisible regardless of reaction counts", () => {
      const nodes = [
        createAssertion("asrt_public", "2024-01-01T00:00:00Z", "public"),
        createAssertion("asrt_private", "2024-01-02T00:00:00Z", "private"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_public", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_private", target: "user_author" },
        // Private assertion has many reactions
        ...Array.from({ length: 100 }, () => ({
          type: EDGES.REACTED_TO,
          target: "asrt_private",
          reactionType: "like",
        })),
      ];

      // Viewer is NOT the author
      const feed = assembleHome({ nodes, edges }, { viewerId: "other_user" });

      // INVARIANT: Private assertion is NOT visible to non-author
      // Despite having many reactions
      expect(feed.length).toBe(1);
      expect(feed[0].assertionId).toBe("asrt_public");
    });
  });

  // ============================================================
  // INVARIANT: Counts are accurate and neutral
  // ============================================================
  describe("Count Accuracy", () => {
    it("aggregates counts correctly by type", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "acknowledge" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "acknowledge" },
      ];

      const feed = assembleHome({ nodes, edges }, { viewerId: null });

      expect(feed[0].reactionCounts).toEqual({
        like: 3,
        acknowledge: 2,
      });
    });

    it("returns zero counts when no reactions exist", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
      ];

      const feed = assembleHome({ nodes, edges }, { viewerId: null });

      expect(feed[0].reactionCounts).toEqual({
        like: 0,
        acknowledge: 0,
      });
    });

    it("includes reactionCounts on nested responses in home feed", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply", "2024-01-01T01:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply", target: "asrt_root" },
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "like" },
      ];

      const feed = assembleHome({ nodes, edges }, { viewerId: null });

      expect(feed[0].responses).toBeDefined();
      expect(feed[0].responses[0].reactionCounts).toEqual({
        like: 1,
        acknowledge: 0,
      });
    });
  });

  // ============================================================
  // INVARIANT: Reactions are non-structural (E.1.1 verification)
  // ============================================================
  describe("Non-Structural Verification", () => {
    it("feed structure is identical with and without reactions", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_2", "2024-01-02T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const baseEdges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_2", target: "user_author" },
      ];

      // Feed without reactions
      const feedNoReactions = assembleHome({ nodes, edges: baseEdges }, { viewerId: null });

      // Feed with reactions
      const edgesWithReactions = [
        ...baseEdges,
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_2", reactionType: "acknowledge" },
      ];
      const feedWithReactions = assembleHome({ nodes, edges: edgesWithReactions }, { viewerId: null });

      // INVARIANT: Same number of items, same order
      expect(feedWithReactions.length).toBe(feedNoReactions.length);
      expect(feedWithReactions[0].assertionId).toBe(feedNoReactions[0].assertionId);
      expect(feedWithReactions[1].assertionId).toBe(feedNoReactions[1].assertionId);

      // Only difference should be reactionCounts values
      expect(feedNoReactions[0].reactionCounts).toEqual({ like: 0, acknowledge: 0 });
      expect(feedWithReactions[0].reactionCounts).toEqual({ like: 0, acknowledge: 1 });
    });
  });

  // ============================================================
  // INVARIANT: Aggregation is read-only
  // ============================================================
  describe("Read-Only Aggregation", () => {
    it("aggregation does not modify the input graph nodes", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
      ];

      // Capture original state
      const originalNodeState = JSON.stringify(nodes);
      const originalEdgeState = JSON.stringify(edges);

      // Run projection
      assembleHome({ nodes, edges }, { viewerId: null });

      // INVARIANT: Input graph is unchanged
      expect(JSON.stringify(nodes)).toBe(originalNodeState);
      expect(JSON.stringify(edges)).toBe(originalEdgeState);
    });

    it("aggregation does not modify the input graph edges", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply", "2024-01-01T01:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply", target: "asrt_root" },
        { type: EDGES.REACTED_TO, target: "asrt_root", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "acknowledge" },
      ];

      const originalEdgeCount = edges.length;

      // Run projection
      assembleThread({ nodes, edges }, "asrt_root", { viewerId: null });

      // INVARIANT: No edges added or removed
      expect(edges.length).toBe(originalEdgeCount);
    });

    it("multiple projections on same graph produce identical results", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
      ];

      // Run projection multiple times
      const result1 = assembleHome({ nodes, edges }, { viewerId: null });
      const result2 = assembleHome({ nodes, edges }, { viewerId: null });
      const result3 = assembleHome({ nodes, edges }, { viewerId: null });

      // INVARIANT: Idempotent - same input produces same output
      expect(result1[0].reactionCounts).toEqual(result2[0].reactionCounts);
      expect(result2[0].reactionCounts).toEqual(result3[0].reactionCounts);
      expect(result1[0].reactionCounts.like).toBe(2);
    });
  });

  // ============================================================
  // INVARIANT: Roots and replies are treated symmetrically
  // ============================================================
  describe("Root/Reply Symmetry", () => {
    it("roots and replies have identical reactionCounts shape", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply", "2024-01-01T01:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply", target: "asrt_root" },
        { type: EDGES.REACTED_TO, target: "asrt_root", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "acknowledge" },
      ];

      const thread = assembleThread({ nodes, edges }, "asrt_root", { viewerId: null });

      const root = thread.find(item => item.assertionId === "asrt_root");
      const reply = thread.find(item => item.assertionId === "asrt_reply");

      // INVARIANT: Both have reactionCounts with identical structure
      expect(root.reactionCounts).toBeDefined();
      expect(reply.reactionCounts).toBeDefined();
      expect(Object.keys(root.reactionCounts).sort()).toEqual(Object.keys(reply.reactionCounts).sort());
      expect(Object.keys(root.reactionCounts)).toEqual(["like", "acknowledge"]);
    });

    it("reaction aggregation applies equally to roots and replies", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply", "2024-01-01T01:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      // Same number of reactions on both
      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply", target: "asrt_root" },
        // 3 likes on root
        { type: EDGES.REACTED_TO, target: "asrt_root", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_root", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_root", reactionType: "like" },
        // 3 likes on reply
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "like" },
      ];

      const thread = assembleThread({ nodes, edges }, "asrt_root", { viewerId: null });

      const root = thread.find(item => item.assertionId === "asrt_root");
      const reply = thread.find(item => item.assertionId === "asrt_reply");

      // INVARIANT: Same reaction count produces same aggregated value
      expect(root.reactionCounts.like).toBe(3);
      expect(reply.reactionCounts.like).toBe(3);
    });

    it("deeply nested replies receive reactionCounts", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply1", "2024-01-01T01:00:00Z", "public", "response"),
        createAssertion("asrt_reply2", "2024-01-01T02:00:00Z", "public", "response"),
        createAssertion("asrt_reply3", "2024-01-01T03:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply1", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply2", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply3", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply1", target: "asrt_root" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply2", target: "asrt_reply1" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply3", target: "asrt_reply2" },
        // Reaction on deepest reply
        { type: EDGES.REACTED_TO, target: "asrt_reply3", reactionType: "acknowledge" },
      ];

      const thread = assembleThread({ nodes, edges }, "asrt_root", { viewerId: null });

      const deepReply = thread.find(item => item.assertionId === "asrt_reply3");

      // INVARIANT: Deeply nested replies have reactionCounts
      expect(deepReply.reactionCounts).toBeDefined();
      expect(deepReply.reactionCounts.acknowledge).toBe(1);
    });
  });

  // ============================================================
  // INVARIANT: Removing reactions does not alter content semantics
  // ============================================================
  describe("Reaction Removal Semantics", () => {
    it("assertion content is unchanged when reactions are removed", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createIdentity("user_author"),
      ];

      // Graph with reactions
      const edgesWithReactions = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_1", reactionType: "acknowledge" },
      ];

      // Graph without reactions (simulating removal)
      const edgesWithoutReactions = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
      ];

      const feedWithReactions = assembleHome({ nodes, edges: edgesWithReactions }, { viewerId: null });
      const feedWithoutReactions = assembleHome({ nodes, edges: edgesWithoutReactions }, { viewerId: null });

      // INVARIANT: Content semantics unchanged
      expect(feedWithReactions[0].assertionId).toBe(feedWithoutReactions[0].assertionId);
      expect(feedWithReactions[0].text).toBe(feedWithoutReactions[0].text);
      expect(feedWithReactions[0].author).toEqual(feedWithoutReactions[0].author);
      expect(feedWithReactions[0].createdAt).toBe(feedWithoutReactions[0].createdAt);
      expect(feedWithReactions[0].visibility).toBe(feedWithoutReactions[0].visibility);
      expect(feedWithReactions[0].assertionType).toBe(feedWithoutReactions[0].assertionType);
    });

    it("thread structure is unchanged when reactions are removed", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply", "2024-01-01T01:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const baseEdges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply", target: "asrt_root" },
      ];

      // With reactions
      const edgesWithReactions = [
        ...baseEdges,
        { type: EDGES.REACTED_TO, target: "asrt_root", reactionType: "like" },
        { type: EDGES.REACTED_TO, target: "asrt_reply", reactionType: "acknowledge" },
      ];

      const threadWithReactions = assembleThread({ nodes, edges: edgesWithReactions }, "asrt_root", { viewerId: null });
      const threadWithoutReactions = assembleThread({ nodes, edges: baseEdges }, "asrt_root", { viewerId: null });

      // INVARIANT: Thread structure unchanged
      expect(threadWithReactions.length).toBe(threadWithoutReactions.length);
      expect(threadWithReactions[0].assertionId).toBe(threadWithoutReactions[0].assertionId);
      expect(threadWithReactions[1].assertionId).toBe(threadWithoutReactions[1].assertionId);
      expect(threadWithReactions[1].replyTo).toBe(threadWithoutReactions[1].replyTo);
    });

    it("response nesting is unchanged when reactions are removed", () => {
      const nodes = [
        createAssertion("asrt_root", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_reply", "2024-01-01T01:00:00Z", "public", "response"),
        createIdentity("user_author"),
      ];

      const baseEdges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_root", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_reply", target: "user_author" },
        { type: EDGES.RESPONDS_TO, source: "asrt_reply", target: "asrt_root" },
      ];

      // Many reactions
      const edgesWithManyReactions = [
        ...baseEdges,
        ...Array.from({ length: 50 }, () => ({
          type: EDGES.REACTED_TO,
          target: "asrt_reply",
          reactionType: "like",
        })),
      ];

      const feedWithReactions = assembleHome({ nodes, edges: edgesWithManyReactions }, { viewerId: null });
      const feedWithoutReactions = assembleHome({ nodes, edges: baseEdges }, { viewerId: null });

      // INVARIANT: Response nesting preserved
      expect(feedWithReactions[0].responses).toBeDefined();
      expect(feedWithoutReactions[0].responses).toBeDefined();
      expect(feedWithReactions[0].responses.length).toBe(feedWithoutReactions[0].responses.length);
      expect(feedWithReactions[0].responses[0].assertionId).toBe(feedWithoutReactions[0].responses[0].assertionId);
    });
  });

  // ============================================================
  // INVARIANT: No prominence effects (CONTRACTS.md §3.2)
  // ============================================================
  describe("No Prominence Effects", () => {
    it("high reaction counts do not affect feed inclusion", () => {
      const nodes = [
        createAssertion("asrt_popular", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_unpopular", "2024-01-02T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_popular", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_unpopular", target: "user_author" },
        // 1000 reactions on "popular"
        ...Array.from({ length: 1000 }, () => ({
          type: EDGES.REACTED_TO,
          target: "asrt_popular",
          reactionType: "like",
        })),
        // 0 reactions on "unpopular"
      ];

      const feed = assembleHome({ nodes, edges }, { viewerId: null });

      // INVARIANT: Both items appear in feed
      expect(feed.length).toBe(2);
      expect(feed.map(f => f.assertionId)).toContain("asrt_popular");
      expect(feed.map(f => f.assertionId)).toContain("asrt_unpopular");
    });

    it("zero reaction counts do not affect feed inclusion", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_2", "2024-01-02T00:00:00Z"),
        createAssertion("asrt_3", "2024-01-03T00:00:00Z"),
        createIdentity("user_author"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_2", target: "user_author" },
        { type: EDGES.AUTHORED_BY, source: "asrt_3", target: "user_author" },
        // No reactions on any
      ];

      const feed = assembleHome({ nodes, edges }, { viewerId: null });

      // INVARIANT: All items appear despite zero reactions
      expect(feed.length).toBe(3);
      feed.forEach(item => {
        expect(item.reactionCounts.like).toBe(0);
        expect(item.reactionCounts.acknowledge).toBe(0);
      });
    });

    it("profile feed is unaffected by reaction counts", () => {
      const nodes = [
        createAssertion("asrt_1", "2024-01-01T00:00:00Z"),
        createAssertion("asrt_2", "2024-01-02T00:00:00Z"),
        createIdentity("user_target"),
      ];

      const edges = [
        { type: EDGES.AUTHORED_BY, source: "asrt_1", target: "user_target" },
        { type: EDGES.AUTHORED_BY, source: "asrt_2", target: "user_target" },
        // Older has more reactions
        ...Array.from({ length: 100 }, () => ({
          type: EDGES.REACTED_TO,
          target: "asrt_1",
          reactionType: "like",
        })),
      ];

      const profile = assembleProfile({ nodes, edges }, "user_target", { viewerId: null });

      // INVARIANT: Profile order is chronological, not by popularity
      expect(profile[0].assertionId).toBe("asrt_2"); // Newer first
      expect(profile[1].assertionId).toBe("asrt_1"); // Older second despite more reactions
    });
  });
});
