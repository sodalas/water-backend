// src/domain/feed/__tests__/Projection.versionResolution.test.js
// Phase B3: Tests for version resolution in responses and threads

import { describe, it, expect } from "vitest";
import { assembleHome, assembleThread } from "../Projection.js";
import { NODES, EDGES } from "../../graph/Model.js";

describe("Phase B3: Version Resolution in Projections", () => {
  describe("assembleHome - Response Version Filtering", () => {
    it("should show only head version of responses", () => {
      const graph = {
        nodes: [
          // Root assertion
          { id: "root_1", type: NODES.ASSERTION, text: "Root post", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Original response
          { id: "resp_original", type: NODES.ASSERTION, text: "Original response", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          // Revised response (supersedes original)
          { id: "resp_revised", type: NODES.ASSERTION, text: "Revised response", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_original", revisionNumber: 1, rootAssertionId: "resp_original" },
          // Author
          { id: "user_1", type: NODES.IDENTITY, handle: "testuser", displayName: "Test User" },
        ],
        edges: [
          // Root authored by user
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          // Responses authored by user
          { source: "resp_original", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_revised", target: "user_1", type: EDGES.AUTHORED_BY },
          // Original response to root
          { source: "resp_original", target: "root_1", type: EDGES.RESPONDS_TO },
          // Revised response to root
          { source: "resp_revised", target: "root_1", type: EDGES.RESPONDS_TO },
          // Revision edge
          { source: "resp_original", target: "resp_revised", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      expect(feed).toHaveLength(1);
      expect(feed[0].responses).toHaveLength(1);
      expect(feed[0].responses[0].assertionId).toBe("resp_revised");
      expect(feed[0].responses[0].text).toBe("Revised response");
    });

    it("should exclude superseded responses completely", () => {
      const graph = {
        nodes: [
          { id: "root_1", type: NODES.ASSERTION, text: "Root", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          { id: "resp_v1", type: NODES.ASSERTION, text: "Version 1", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          { id: "resp_v2", type: NODES.ASSERTION, text: "Version 2", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_v1", revisionNumber: 1 },
          { id: "resp_v3", type: NODES.ASSERTION, text: "Version 3", createdAt: "2024-01-01T03:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_v2", revisionNumber: 2 },
          { id: "user_1", type: NODES.IDENTITY, handle: "testuser" },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v3", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_v1", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_v2", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_v3", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_v1", target: "resp_v2", type: "SUPERSEDES" },
          { source: "resp_v2", target: "resp_v3", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      expect(feed[0].responses).toHaveLength(1);
      expect(feed[0].responses[0].assertionId).toBe("resp_v3");
      expect(feed[0].responses[0].text).toBe("Version 3");
    });

    it("should handle mix of original and revised responses", () => {
      const graph = {
        nodes: [
          { id: "root_1", type: NODES.ASSERTION, text: "Root", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // First response - never revised
          { id: "resp_1_original", type: NODES.ASSERTION, text: "Response 1 - Original", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          // Second response - has revision
          { id: "resp_2_original", type: NODES.ASSERTION, text: "Response 2 - Original", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public" },
          { id: "resp_2_revised", type: NODES.ASSERTION, text: "Response 2 - Revised", createdAt: "2024-01-01T03:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_2_original" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_original", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_2_original", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_2_revised", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_original", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_2_original", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_2_revised", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "resp_2_original", target: "resp_2_revised", type: "SUPERSEDES" },
        ],
      };

      const feed = assembleHome(graph, { viewerId: "user_1" });

      expect(feed[0].responses).toHaveLength(2);
      const responseIds = feed[0].responses.map(r => r.assertionId).sort();
      expect(responseIds).toEqual(["resp_1_original", "resp_2_revised"]);
    });
  });

  describe("assembleThread - Thread Version Filtering", () => {
    it("should show only head version in thread", () => {
      const graph = {
        nodes: [
          // Root
          { id: "root_1", type: NODES.ASSERTION, text: "Root", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Original node in thread
          { id: "thread_v1", type: NODES.ASSERTION, text: "Thread node v1", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          // Revised version
          { id: "thread_v2", type: NODES.ASSERTION, text: "Thread node v2", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "thread_v1" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "thread_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "thread_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "thread_v1", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "thread_v2", target: "root_1", type: EDGES.RESPONDS_TO },
          { source: "thread_v1", target: "thread_v2", type: "SUPERSEDES" },
        ],
      };

      const thread = assembleThread(graph, "root_1", { viewerId: "user_1" });

      expect(thread).toHaveLength(2); // root + 1 response
      const nodeIds = thread.map(n => n.assertionId).sort();
      expect(nodeIds).toEqual(["root_1", "thread_v2"]);
    });

    it("should handle deep thread with revisions at multiple levels", () => {
      const graph = {
        nodes: [
          { id: "root", type: NODES.ASSERTION, text: "Root", createdAt: "2024-01-01T00:00:00Z", assertionType: "assertion", visibility: "public" },
          // Level 1 - revised
          { id: "resp_1_v1", type: NODES.ASSERTION, text: "L1 v1", createdAt: "2024-01-01T01:00:00Z", assertionType: "response", visibility: "public" },
          { id: "resp_1_v2", type: NODES.ASSERTION, text: "L1 v2", createdAt: "2024-01-01T02:00:00Z", assertionType: "response", visibility: "public", supersedesId: "resp_1_v1" },
          // Level 2 - original (no revision)
          { id: "resp_2", type: NODES.ASSERTION, text: "L2 original", createdAt: "2024-01-01T03:00:00Z", assertionType: "response", visibility: "public" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_v1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_v2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_2", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "resp_1_v1", target: "root", type: EDGES.RESPONDS_TO },
          { source: "resp_1_v2", target: "root", type: EDGES.RESPONDS_TO },
          { source: "resp_2", target: "resp_1_v2", type: EDGES.RESPONDS_TO }, // Response to v2
          { source: "resp_1_v1", target: "resp_1_v2", type: "SUPERSEDES" },
        ],
      };

      const thread = assembleThread(graph, "root", { viewerId: "user_1" });

      expect(thread).toHaveLength(3); // root + resp_1_v2 + resp_2
      const nodeIds = thread.map(n => n.assertionId).sort();
      expect(nodeIds).toEqual(["resp_1_v2", "resp_2", "root"]);
    });
  });
});
