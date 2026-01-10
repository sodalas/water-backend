// src/routes/assertions.js
import { Router } from "express";
import { getGraphAdapter } from "../infrastructure/graph/getGraphAdapter.js";

const router = Router();

/**
 * GET /api/assertions/:id/history
 * Phase B3: Returns revision history for an assertion
 *
 * AuthZ: Only author can access (admin support can be added later)
 * Returns ordered chain (oldest → newest)
 */
router.get("/assertions/:id/history", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const assertionId = req.params.id;
  if (!assertionId) {
    return res.status(400).json({ error: "Assertion ID required" });
  }

  try {
    const graph = getGraphAdapter();
    const history = await graph.getRevisionHistory(assertionId);

    if (!history || history.length === 0) {
      return res.status(404).json({ error: "Assertion not found" });
    }

    // AuthZ: Only author can access history
    const authorId = history[0].author.id;
    if (authorId !== userId) {
      return res.status(403).json({ error: "Forbidden: Only the author can view revision history" });
    }

    return res.status(200).json({
      history,
      count: history.length,
    });
  } catch (error) {
    console.error("[History] Error fetching revision history:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * DELETE /api/assertions/:id
 * Phase B3.4-A: Delete via Canon B tombstone supersession
 * Phase B3.5-C: Constraint violation handling (409 Conflict)
 *
 * AuthZ: Only author can delete
 * Creates tombstone assertion that supersedes target
 */
router.delete("/assertions/:id", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const assertionId = req.params.id;
  if (!assertionId) {
    return res.status(400).json({ error: "Assertion ID required" });
  }

  try {
    const graph = getGraphAdapter();
    const result = await graph.deleteAssertion(assertionId, userId);

    if (!result.success) {
      if (result.error === 'not_found') {
        return res.status(404).json({ error: "Assertion not found" });
      }
      if (result.error === 'forbidden') {
        return res.status(403).json({ error: "Forbidden: Only the author can delete this assertion" });
      }
      if (result.error === 'already_superseded') {
        // Phase B3.5-C: Return 409 for assertions already revised
        return res.status(409).json({ error: "This assertion has already been revised or deleted." });
      }
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (result.alreadyDeleted) {
      return res.status(200).json({ message: "Assertion already deleted" });
    }

    return res.status(200).json({ message: "Assertion deleted successfully" });
  } catch (error) {
    // Phase B3.5-C: Handle Neo4j uniqueness constraint violations
    // Neo4j constraint violations have code 'Neo.ClientError.Schema.ConstraintValidationFailed'
    if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      console.warn("[Delete] Conflict: Uniqueness constraint violation", {
        userId,
        assertionId,
        error: error.message,
      });
      return res.status(409).json({
        error: "This assertion has already been revised or deleted."
      });
    }

    console.error("[Delete] Error deleting assertion:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
