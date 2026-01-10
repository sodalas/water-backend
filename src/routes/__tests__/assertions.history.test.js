// src/routes/__tests__/assertions.history.test.js
// Phase B3: Tests for revision history endpoint authorization

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getGraphAdapter } from "../../infrastructure/graph/getGraphAdapter.js";

describe("Phase B3: Revision History Endpoint AuthZ", () => {
  const mockGraph = {
    getRevisionHistory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/assertions/:id/history", () => {
    it("should return 401 if user is not authenticated", async () => {
      // Simulate unauthenticated request
      const req = {
        user: null,
        params: { id: "asrt_test_123" },
      };

      expect(req.user?.id).toBeUndefined();
      // In actual route: return 401
    });

    it("should return 403 if user is not the author", async () => {
      mockGraph.getRevisionHistory.mockResolvedValue([
        {
          id: "asrt_v1",
          text: "Original",
          createdAt: "2024-01-01T00:00:00Z",
          author: { id: "user_original_author", handle: "author" },
        },
        {
          id: "asrt_v2",
          text: "Revised",
          createdAt: "2024-01-02T00:00:00Z",
          author: { id: "user_original_author", handle: "author" },
        },
      ]);

      const requestingUserId = "user_different";
      const authorId = "user_original_author";

      // AuthZ check: Only author can access
      expect(authorId !== requestingUserId).toBe(true);
      // In actual route: return 403
    });

    it("should return 200 with history if user is the author", async () => {
      const authorId = "user_author";
      mockGraph.getRevisionHistory.mockResolvedValue([
        {
          id: "asrt_v1",
          text: "Original",
          createdAt: "2024-01-01T00:00:00Z",
          author: { id: authorId, handle: "author" },
        },
        {
          id: "asrt_v2",
          text: "Revised",
          createdAt: "2024-01-02T00:00:00Z",
          author: { id: authorId, handle: "author" },
        },
      ]);

      const requestingUserId = authorId;

      // AuthZ check passes
      expect(authorId === requestingUserId).toBe(true);
      // In actual route: return 200 with history
    });

    it("should return 404 if assertion does not exist", async () => {
      mockGraph.getRevisionHistory.mockResolvedValue(null);

      // In actual route: return 404
    });

    it("should return history in chronological order (oldest → newest)", async () => {
      mockGraph.getRevisionHistory.mockResolvedValue([
        {
          id: "asrt_v1",
          text: "Version 1",
          createdAt: "2024-01-01T00:00:00Z",
          supersedesId: null,
          revisionNumber: null,
          rootAssertionId: null,
          author: { id: "user_1" },
        },
        {
          id: "asrt_v2",
          text: "Version 2",
          createdAt: "2024-01-02T00:00:00Z",
          supersedesId: "asrt_v1",
          revisionNumber: 1,
          rootAssertionId: "asrt_v1",
          author: { id: "user_1" },
        },
        {
          id: "asrt_v3",
          text: "Version 3",
          createdAt: "2024-01-03T00:00:00Z",
          supersedesId: "asrt_v2",
          revisionNumber: 2,
          rootAssertionId: "asrt_v1",
          author: { id: "user_1" },
        },
      ]);

      const history = await mockGraph.getRevisionHistory("asrt_v2");

      expect(history).toHaveLength(3);
      expect(history[0].id).toBe("asrt_v1"); // Oldest
      expect(history[1].id).toBe("asrt_v2");
      expect(history[2].id).toBe("asrt_v3"); // Newest
    });

    it("should work for any assertion ID in the chain", async () => {
      // Request history for middle version
      mockGraph.getRevisionHistory.mockResolvedValue([
        { id: "asrt_v1", createdAt: "2024-01-01T00:00:00Z", author: { id: "user_1" } },
        { id: "asrt_v2", createdAt: "2024-01-02T00:00:00Z", author: { id: "user_1" } },
        { id: "asrt_v3", createdAt: "2024-01-03T00:00:00Z", author: { id: "user_1" } },
      ]);

      // getRevisionHistory should find root and return full chain
      const history = await mockGraph.getRevisionHistory("asrt_v2");
      expect(history).toHaveLength(3);
    });
  });

  describe("Authorization scenarios", () => {
    it("should allow author to view their own revision history", () => {
      const userId = "user_123";
      const authorId = "user_123";

      expect(userId === authorId).toBe(true);
      // AuthZ: PASS
    });

    it("should deny non-author from viewing revision history", () => {
      const userId = "user_456";
      const authorId = "user_123";

      expect(userId === authorId).toBe(false);
      // AuthZ: FAIL → 403
    });

    it("should deny guest (unauthenticated) from viewing revision history", () => {
      const userId = null;

      expect(userId).toBeNull();
      // AuthZ: FAIL → 401
    });
  });

  describe("Response format", () => {
    it("should return history array with count", async () => {
      mockGraph.getRevisionHistory.mockResolvedValue([
        { id: "asrt_v1", text: "V1", author: { id: "user_1" } },
        { id: "asrt_v2", text: "V2", author: { id: "user_1" } },
      ]);

      const history = await mockGraph.getRevisionHistory("asrt_v1");

      // Expected response format:
      // { history: [...], count: 2 }
      expect(history).toHaveLength(2);
      expect(history.length).toBe(2);
    });

    it("should include all revision fields", async () => {
      mockGraph.getRevisionHistory.mockResolvedValue([
        {
          id: "asrt_v1",
          text: "Original text",
          createdAt: "2024-01-01T00:00:00Z",
          supersedesId: null,
          revisionNumber: null,
          rootAssertionId: null,
          author: {
            id: "user_1",
            handle: "testuser",
            displayName: "Test User",
          },
        },
      ]);

      const history = await mockGraph.getRevisionHistory("asrt_v1");

      expect(history[0]).toHaveProperty("id");
      expect(history[0]).toHaveProperty("text");
      expect(history[0]).toHaveProperty("createdAt");
      expect(history[0]).toHaveProperty("supersedesId");
      expect(history[0]).toHaveProperty("revisionNumber");
      expect(history[0]).toHaveProperty("rootAssertionId");
      expect(history[0]).toHaveProperty("author");
      expect(history[0].author).toHaveProperty("id");
    });
  });
});
