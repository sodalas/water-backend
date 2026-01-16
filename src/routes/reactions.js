// src/routes/reactions.js

/**
 * Phase E.1: Reactions API
 *
 * Provides endpoints for adding, removing, and fetching reactions.
 *
 * Endpoints:
 * - POST /reactions - Add a reaction
 * - DELETE /reactions - Remove a reaction
 * - GET /reactions/:assertionId - Get reactions for an assertion
 */

import { Router } from "express";
import { isValidReactionType } from "../domain/reactions/ReactionTypes.js";
import { getGraphAdapter } from "../infrastructure/graph/getGraphAdapter.js";
import { captureError, addBreadcrumb, logNearMiss } from "../sentry.js";
import { notifyReaction } from "../domain/notifications/NotificationService.js";

const router = Router();

/**
 * POST /reactions
 *
 * Add a reaction to an assertion.
 *
 * Body: { assertionId: string, reactionType: 'like' | 'acknowledge' }
 * Response: { success: true, action: 'added' }
 *
 * Errors:
 * - 400: Invalid reaction type or missing fields
 * - 401: Not authenticated
 * - 403: No visibility to assertion
 * - 404: Assertion not found
 * - 409: Assertion is superseded or tombstoned
 */
router.post("/reactions", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { assertionId, reactionType } = req.body;

  // Validate required fields
  if (!assertionId || typeof assertionId !== "string") {
    return res.status(400).json({ error: "Missing or invalid assertionId" });
  }

  if (!reactionType || !isValidReactionType(reactionType)) {
    return res.status(400).json({
      error: "Invalid reactionType. Must be 'like' or 'acknowledge'",
    });
  }

  // Add breadcrumb for observability
  addBreadcrumb("reaction", "Adding reaction", {
    userId,
    assertionId,
    reactionType,
  });

  try {
    const graph = getGraphAdapter();
    const result = await graph.addReaction(userId, assertionId, reactionType);

    if (result.error === "not_found") {
      return res.status(404).json({ error: "Assertion not found" });
    }

    if (result.error === "superseded") {
      logNearMiss("reaction-on-superseded", {
        route: "/reactions",
        userId,
        assertionId,
        reactionType,
      });
      return res.status(409).json({
        error: "Cannot react to a superseded assertion",
      });
    }

    if (result.error === "tombstoned") {
      logNearMiss("reaction-on-tombstoned", {
        route: "/reactions",
        userId,
        assertionId,
        reactionType,
      });
      return res.status(409).json({
        error: "Cannot react to a deleted assertion",
      });
    }

    if (result.error === "visibility") {
      return res.status(403).json({
        error: "You do not have permission to view this assertion",
      });
    }

    // Phase E.2: Fire reaction notification (non-blocking)
    // Fetch assertion author for notification
    const assertion = await graph.getAssertionForRevision(assertionId);
    if (assertion && assertion.authorId) {
      notifyReaction({
        actorId: userId,
        assertionId,
        reactionType,
        assertionAuthorId: assertion.authorId,
      }).catch((err) => {
        console.error("[NOTIFICATION] Reaction notification failed:", err);
        captureError(err, {
          route: "/reactions",
          operation: "notify-reaction",
          userId,
          assertionId,
          reactionType,
        });
      });
    }

    // Success - note that MERGE is idempotent so this always succeeds
    return res.status(200).json({
      success: true,
      action: "added",
    });
  } catch (error) {
    console.error("Reaction Error:", error);
    captureError(error, {
      route: "/reactions",
      operation: "add",
      userId,
      assertionId,
      reactionType,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * DELETE /reactions
 *
 * Remove a reaction from an assertion.
 *
 * Body: { assertionId: string, reactionType: 'like' | 'acknowledge' }
 * Response: { success: true, action: 'removed' | 'not_found' }
 */
router.delete("/reactions", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { assertionId, reactionType } = req.body;

  // Validate required fields
  if (!assertionId || typeof assertionId !== "string") {
    return res.status(400).json({ error: "Missing or invalid assertionId" });
  }

  if (!reactionType || !isValidReactionType(reactionType)) {
    return res.status(400).json({
      error: "Invalid reactionType. Must be 'like' or 'acknowledge'",
    });
  }

  // Add breadcrumb for observability
  addBreadcrumb("reaction", "Removing reaction", {
    userId,
    assertionId,
    reactionType,
  });

  try {
    const graph = getGraphAdapter();
    const result = await graph.removeReaction(userId, assertionId, reactionType);

    // Near-miss: reaction already absent (idempotent no-op)
    if (!result.removed) {
      logNearMiss("reaction-remove-already-absent", {
        route: "/reactions",
        userId,
        assertionId,
        reactionType,
      });
    }

    return res.status(200).json({
      success: true,
      action: result.removed ? "removed" : "not_found",
    });
  } catch (error) {
    console.error("Reaction Remove Error:", error);
    captureError(error, {
      route: "/reactions",
      operation: "remove",
      userId,
      assertionId,
      reactionType,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /reactions/:assertionId
 *
 * Get reactions for an assertion.
 *
 * Response: {
 *   counts: { like: number, acknowledge: number },
 *   userReactions: string[]  // Types the current user has reacted with
 * }
 */
router.get("/reactions/:assertionId", async (req, res) => {
  const { assertionId } = req.params;
  const viewerId = req.user?.id ?? null;

  if (!assertionId) {
    return res.status(400).json({ error: "Missing assertionId" });
  }

  try {
    const graph = getGraphAdapter();
    const result = await graph.getReactionsForAssertion(assertionId, viewerId);

    return res.status(200).json({
      counts: result.counts,
      userReactions: result.userReactions,
    });
  } catch (error) {
    console.error("Reaction Fetch Error:", error);
    captureError(error, {
      route: "/reactions/:assertionId",
      operation: "get",
      assertionId,
      viewerId,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
