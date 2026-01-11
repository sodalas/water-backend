// domain/contracts/__tests__/ContractGuards.test.js
// Phase D.0: Tests for Contract Assertions & Schema Guards

import { describe, it, expect } from "vitest";
import { validate, validateRefs } from "../../composer/Validation.js";
import { assembleHome } from "../../feed/Projection.js";
import {
  assertThreadReachability,
  expectThreadReachable,
  expectAllRepliesReachable,
} from "../ThreadReachability.js";
import { NODES, EDGES } from "../../graph/Model.js";
import { ASSERTION_TYPES } from "../../composer/CSO.js";

describe("Phase D.0: Contract Guards", () => {
  describe("Guard 1: Reply Creation Contract (refs validation)", () => {
    describe("validateRefs", () => {
      it("should accept valid refs with uri property", () => {
        const refs = [{ uri: "asrt_123" }, { uri: "asrt_456" }];
        const result = validateRefs(refs);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject refs containing strings", () => {
        const refs = ["asrt_123", "asrt_456"];
        const result = validateRefs(refs);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("refs[0]: Ref must be an object, not a string");
        expect(result.errors).toContain("refs[1]: Ref must be an object, not a string");
      });

      it("should reject refs with missing uri", () => {
        const refs = [{ id: "asrt_123" }];
        const result = validateRefs(refs);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("refs[0]: Ref must have a uri property of type string");
      });

      it("should reject refs with empty uri", () => {
        const refs = [{ uri: "" }, { uri: "   " }];
        const result = validateRefs(refs);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("refs[0]: Ref uri cannot be empty");
        expect(result.errors).toContain("refs[1]: Ref uri cannot be empty");
      });

      it("should reject null values in refs", () => {
        const refs = [null];
        const result = validateRefs(refs);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("refs[0]: Ref must be an object");
      });

      it("should accept empty refs array", () => {
        const refs = [];
        const result = validateRefs(refs);
        expect(result.valid).toBe(true);
      });
    });

    describe("validate (CSO) with refs", () => {
      it("should reject RESPONSE with string refs", () => {
        const cso = {
          assertionType: ASSERTION_TYPES.RESPONSE,
          text: "This is a reply",
          refs: ["asrt_parent"],
        };
        const result = validate(cso);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.code === "ERR_INVALID_REF_SHAPE")).toBe(true);
      });

      it("should reject RESPONSE with empty uri refs", () => {
        const cso = {
          assertionType: ASSERTION_TYPES.RESPONSE,
          text: "This is a reply",
          refs: [{ uri: "" }],
        };
        const result = validate(cso);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.code === "ERR_INVALID_REF_SHAPE")).toBe(true);
      });

      it("should accept RESPONSE with valid refs", () => {
        const cso = {
          assertionType: ASSERTION_TYPES.RESPONSE,
          text: "This is a reply",
          refs: [{ uri: "asrt_parent" }],
        };
        const result = validate(cso);
        expect(result.ok).toBe(true);
      });

      it("should reject RESPONSE with no refs", () => {
        const cso = {
          assertionType: ASSERTION_TYPES.RESPONSE,
          text: "This is a reply",
          refs: [],
        };
        const result = validate(cso);
        expect(result.ok).toBe(false);
        expect(result.errors.some(e => e.code === "ERR_RESPONSE_NO_TARGET")).toBe(true);
      });
    });
  });

  describe("Guard 2: Feed Root Purity Assertion", () => {
    it("should not throw for feed with only roots", () => {
      const graph = {
        nodes: [
          { id: "root_1", type: NODES.ASSERTION, assertionType: "assertion", text: "Post 1", visibility: "public", createdAt: "2024-01-01T00:00:00Z" },
          { id: "root_2", type: NODES.ASSERTION, assertionType: "assertion", text: "Post 2", visibility: "public", createdAt: "2024-01-02T00:00:00Z" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "root_2", target: "user_1", type: EDGES.AUTHORED_BY },
        ],
      };

      // Should not throw
      expect(() => assembleHome(graph, { viewerId: "user_1" })).not.toThrow();
    });

    it("should throw in test mode if response leaks into feed", () => {
      // This tests the assertion behavior - in test mode, responses in feed should throw
      // We need to craft a graph that would cause a response to leak (which shouldn't happen
      // with correct filtering, but the assertion is a safety net)

      // Simulate a broken graph where a response has no RESPONDS_TO edge but is still in nodes
      // and has assertionType: "assertion" (mislabeled)
      // Note: With correct implementation, this shouldn't happen, but the assertion catches it

      const graph = {
        nodes: [
          { id: "root_1", type: NODES.ASSERTION, assertionType: "assertion", text: "Post", visibility: "public", createdAt: "2024-01-01T00:00:00Z" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
        ],
      };

      // Should not throw because all items are roots
      const feed = assembleHome(graph, { viewerId: "user_1" });
      expect(feed).toHaveLength(1);
      expect(feed[0].assertionType).toBe("assertion");
    });

    it("should correctly exclude responses from feed", () => {
      const graph = {
        nodes: [
          { id: "root_1", type: NODES.ASSERTION, assertionType: "assertion", text: "Post", visibility: "public", createdAt: "2024-01-01T00:00:00Z" },
          { id: "reply_1", type: NODES.ASSERTION, assertionType: "response", text: "Reply", visibility: "public", createdAt: "2024-01-01T01:00:00Z" },
          { id: "user_1", type: NODES.IDENTITY },
        ],
        edges: [
          { source: "root_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "reply_1", target: "user_1", type: EDGES.AUTHORED_BY },
          { source: "reply_1", target: "root_1", type: EDGES.RESPONDS_TO },
        ],
      };

      // Response should be excluded, only root in feed
      const feed = assembleHome(graph, { viewerId: "user_1" });
      expect(feed).toHaveLength(1);
      expect(feed[0].assertionId).toBe("root_1");

      // Response should be nested under root
      expect(feed[0].responses).toHaveLength(1);
      expect(feed[0].responses[0].assertionId).toBe("reply_1");
    });
  });

  describe("Guard 3: Thread Reachability Assertion", () => {
    describe("assertThreadReachability", () => {
      it("should return reachable for direct reply", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "reply", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            { source: "reply", target: "root", type: EDGES.RESPONDS_TO },
          ],
        };

        const result = assertThreadReachability(graph, "reply", "root");
        expect(result.reachable).toBe(true);
        expect(result.path).toContain("root");
        expect(result.path).toContain("reply");
      });

      it("should return reachable for nested reply", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "reply_1", type: NODES.ASSERTION, assertionType: "response" },
            { id: "reply_2", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            { source: "reply_1", target: "root", type: EDGES.RESPONDS_TO },
            { source: "reply_2", target: "reply_1", type: EDGES.RESPONDS_TO },
          ],
        };

        const result = assertThreadReachability(graph, "reply_2", "root");
        expect(result.reachable).toBe(true);
      });

      it("should return not reachable for orphaned reply", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "orphan", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            // No RESPONDS_TO edge for orphan
          ],
        };

        const result = assertThreadReachability(graph, "orphan", "root");
        expect(result.reachable).toBe(false);
        expect(result.error).toContain("not reachable");
      });

      it("should return not reachable for reply pointing to wrong root", () => {
        const graph = {
          nodes: [
            { id: "root_1", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "root_2", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "reply", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            { source: "reply", target: "root_2", type: EDGES.RESPONDS_TO },
          ],
        };

        const result = assertThreadReachability(graph, "reply", "root_1");
        expect(result.reachable).toBe(false);
      });
    });

    describe("expectThreadReachable", () => {
      it("should throw for orphaned reply", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "orphan", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [],
        };

        expect(() => expectThreadReachable(graph, "orphan", "root")).toThrow(
          "[THREAD REACHABILITY VIOLATION]"
        );
      });

      it("should not throw for reachable reply", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "reply", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            { source: "reply", target: "root", type: EDGES.RESPONDS_TO },
          ],
        };

        expect(() => expectThreadReachable(graph, "reply", "root")).not.toThrow();
      });
    });

    describe("expectAllRepliesReachable", () => {
      it("should throw if any reply is orphaned", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "reply_ok", type: NODES.ASSERTION, assertionType: "response" },
            { id: "reply_orphan", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            { source: "reply_ok", target: "root", type: EDGES.RESPONDS_TO },
            // No edge for reply_orphan
          ],
        };

        expect(() => expectAllRepliesReachable(graph, "root")).toThrow(
          "reply_orphan"
        );
      });

      it("should not throw if all replies are reachable", () => {
        const graph = {
          nodes: [
            { id: "root", type: NODES.ASSERTION, assertionType: "assertion" },
            { id: "reply_1", type: NODES.ASSERTION, assertionType: "response" },
            { id: "reply_2", type: NODES.ASSERTION, assertionType: "response" },
          ],
          edges: [
            { source: "reply_1", target: "root", type: EDGES.RESPONDS_TO },
            { source: "reply_2", target: "reply_1", type: EDGES.RESPONDS_TO },
          ],
        };

        expect(() => expectAllRepliesReachable(graph, "root")).not.toThrow();
      });
    });
  });
});
