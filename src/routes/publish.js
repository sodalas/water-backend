// src/routes/publish.js
import { Router } from "express";
import { validate } from "../domain/composer/Validation.js";
import { getGraphAdapter } from "../infrastructure/graph/getGraphAdapter.js";
import { deleteDraftForUser } from "../infrastructure/draft/DraftPersistence.js";
import { canUserReviseAssertion, getUserRole } from "../domain/permissions/RevisionPermissions.js";
import {
  getPublishByIdempotencyKey,
  createPendingIdempotency,
  completeIdempotency,
  recordPublishIdempotency
} from "../infrastructure/idempotency/PublishIdempotency.js";

const router = Router();

/**
 * POST /publish
 * Body: { cso: <ComposerStateObject>, clientId?: string, clearDraft?: boolean, supersedesId?: string, idempotencyKey?: string }
 *
 * Phase B1: Now supports revision via supersedesId field
 * Temporal Invariants: Now supports idempotency via idempotencyKey field
 */
router.post("/publish", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const cso = req.body?.cso;
  const clientId = req.body?.clientId;
  const clearDraft = req.body?.clearDraft === true;
  const supersedesId = req.body?.supersedesId;
  const idempotencyKey = req.body?.idempotencyKey;

  // Backend Correctness Sweep: Idempotency check + pending→complete flow
  if (idempotencyKey) {
    try {
      const existing = await getPublishByIdempotencyKey(idempotencyKey, userId);
      if (existing) {
        // If status is 'complete', replay with existing assertion
        if (existing.status === 'complete') {
          console.info("[IDEMPOTENCY] Replaying existing publish:", {
            userId,
            idempotencyKey,
            assertionId: existing.assertionId,
          });
          return res.status(200).json({
            assertionId: existing.assertionId,
            createdAt: existing.createdAt,
            replayed: true,
          });
        }

        // If status is 'pending', previous request crashed during Neo4j write
        // Check if assertion was created in Neo4j despite the crash
        console.warn("[IDEMPOTENCY] Found pending record, checking Neo4j state:", {
          userId,
          idempotencyKey,
        });

        // For now, treat pending as a conflict and reject
        // Production: Could query Neo4j to check if assertion exists
        return res.status(409).json({
          error: "Publish in progress (pending record found). Please retry.",
        });
      }

      // No existing record: Create pending record BEFORE Neo4j write
      await createPendingIdempotency(idempotencyKey, userId);
      console.info("[IDEMPOTENCY] Created pending record:", {
        userId,
        idempotencyKey,
      });
    } catch (error) {
      console.error("[IDEMPOTENCY] Check failed:", error);
      // Continue with publish - better to allow duplicate than block legitimate request
    }
  }

  // Validate CSO
  const verdict = validate(cso);
  if (!verdict.ok) {
    return res.status(400).json({
      error: "Invalid CSO",
      details: verdict.errors,
      warnings: verdict.warnings,
    });
  }

  try {
    const graph = getGraphAdapter();
    let revisionMetadata = null;

    // Phase B1: Handle revision logic
    if (supersedesId) {
      const userRole = getUserRole(req.user);

      // Log revision attempt
      console.info("[REVISION] Attempt:", {
        viewerId: userId,
        role: userRole,
        supersedesId,
      });

      // 1) Check if superseded assertion exists
      const originalAssertion = await graph.getAssertionForRevision(supersedesId);

      if (!originalAssertion) {
        console.warn("[REVISION] Denied: Original assertion not found", {
          viewerId: userId,
          supersedesId,
        });
        return res.status(400).json({
          error: "Cannot revise: Original assertion not found",
        });
      }

      // 2) Check if already superseded (linear history)
      if (originalAssertion.supersedesId !== null) {
        console.warn("[REVISION] Denied: Already superseded", {
          viewerId: userId,
          supersedesId,
          existingSupersedes: originalAssertion.supersedesId,
        });
        return res.status(409).json({
          error: "Cannot revise: Assertion has already been revised",
        });
      }

      // 3) Permission check
      const canRevise = canUserReviseAssertion({
        userId,
        role: userRole,
        originalAuthorId: originalAssertion.authorId,
      });

      if (!canRevise) {
        console.warn("[REVISION] Denied: Insufficient permissions", {
          viewerId: userId,
          role: userRole,
          originalAuthorId: originalAssertion.authorId,
          supersedesId,
        });
        return res.status(403).json({
          error: "Forbidden: You do not have permission to revise this assertion",
        });
      }

      // 4) Calculate revision metadata
      // Note: For now we're not fetching previous revision metadata from the graph
      // In future phases we could traverse the chain to get accurate counts
      revisionMetadata = {
        revisionNumber: 1, // Simple version: just mark as revised
        rootAssertionId: supersedesId, // For now, treat first revision as root
      };

      console.info("[REVISION] Allowed:", {
        viewerId: userId,
        role: userRole,
        supersedesId,
      });
    }

    // Publish assertion (with or without revision metadata)
    const result = await graph.publish({
      viewer: {
        id: userId,
        handle: req.user?.email ?? req.user?.name ?? null,
        displayName: req.user?.name ?? null,
      },
      cso,
      clientId,
      supersedesId,
      revisionMetadata,
    });

    // Optional: clear saved draft after successful publish
    if (clearDraft) {
      try {
        await deleteDraftForUser(userId);
      } catch (e) {
        // non-fatal; publishing succeeded
        console.warn("Publish succeeded but draft clear failed:", e);
      }
    }

    // Backend Correctness Sweep: Complete idempotency record AFTER Neo4j write
    if (idempotencyKey) {
      try {
        await completeIdempotency(idempotencyKey, userId, result.assertionId);
        console.info("[IDEMPOTENCY] Completed pending record:", {
          userId,
          idempotencyKey,
          assertionId: result.assertionId,
        });
      } catch (error) {
        console.error("[IDEMPOTENCY] Completion failed:", error);
        // non-fatal; publishing succeeded
        // Pending record will expire after 24h
      }
    }

    return res.status(201).json({
      assertionId: result.assertionId,
      createdAt: result.createdAt,
    });
  } catch (error) {
    // Phase B3.5-C: Map revision uniqueness violations to 409 Conflict
    // Neo4j constraint violations have code 'Neo.ClientError.Schema.ConstraintValidationFailed'
    if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed' && supersedesId) {
      console.warn("[REVISION] Conflict: Assertion already revised", {
        userId,
        supersedesId,
        error: error.message,
      });
      return res.status(409).json({
        error: "This assertion has already been revised or deleted."
      });
    }

    console.error("Publish Error:", error);
    return res.status(500).json({ error: "Internal Publish Error" });
  }
});

export default router;
