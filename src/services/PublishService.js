// src/services/PublishService.js
// Phase F.1: Application service for publish orchestration
// Extracts business logic from route, making it reusable by WebSocket/background jobs

import { validate } from "../domain/composer/Validation.js";
import { ASSERTION_TYPES } from "../domain/composer/CSO.js";
import { getGraphAdapter } from "../infrastructure/graph/getGraphAdapter.js";
import { deleteDraftForUser } from "../infrastructure/draft/DraftPersistence.js";
import { canUserReviseAssertion, getUserRole } from "../domain/permissions/RevisionPermissions.js";
import {
  getPublishByIdempotencyKey,
  createPendingIdempotency,
  completeIdempotency,
} from "../infrastructure/idempotency/PublishIdempotency.js";
import { reconcilePending } from "./IdempotencyReconciler.js";
import { captureError, addBreadcrumb, logNearMiss } from "../sentry.js";
import { notifyReply } from "../domain/notifications/NotificationService.js";
import {
  ValidationError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
  IdempotencyError,
  RevisionConflictError,
} from "../domain/errors/AppError.js";

/**
 * Extract assertion ID from a ref object.
 * Handles both { uri: "assertion:<id>" } and { uri: "<id>" } formats.
 */
function extractAssertionIdFromRef(ref) {
  const uri = typeof ref?.uri === "string" ? ref.uri : null;
  if (!uri) return null;
  if (uri.startsWith("assertion:")) return uri.slice("assertion:".length);
  return uri;
}

/**
 * Publish an assertion (root or reply, with optional revision).
 *
 * Orchestrates:
 * - CSO validation
 * - Permission checks (for revisions)
 * - Idempotency choreography (pending → graph write → complete)
 * - Graph publish
 * - Reply notifications (non-blocking)
 * - Draft cleanup (optional)
 *
 * @param {{
 *   viewer: { id: string, email?: string, name?: string },
 *   cso: object,
 *   clientId?: string,
 *   clearDraft?: boolean,
 *   supersedesId?: string,
 *   idempotencyKey?: string,
 * }} input
 * @returns {Promise<{ assertionId: string, createdAt: string, replayed?: boolean }>}
 * @throws {ValidationError} Invalid CSO
 * @throws {ForbiddenError} No permission to revise
 * @throws {NotFoundError} Original assertion not found (revision)
 * @throws {ConflictError} Already revised or idempotency conflict
 * @throws {IdempotencyError} Pending record found, cannot reconcile
 */
export async function publish(input) {
  const { viewer, cso, clientId, clearDraft, supersedesId, idempotencyKey } = input;
  const userId = viewer.id;

  // Breadcrumb for Sentry tracing
  addBreadcrumb("publish", "Starting publish via PublishService", {
    userId,
    hasSupersedes: !!supersedesId,
    hasIdempotencyKey: !!idempotencyKey,
  });

  // === Idempotency Check ===
  if (idempotencyKey) {
    const idempotencyResult = await handleIdempotencyCheck(idempotencyKey, userId);
    if (idempotencyResult) {
      // Replaying existing publish
      return idempotencyResult;
    }
    // Pending record created, continue with publish
  }

  // === CSO Validation ===
  const verdict = validate(cso);
  if (!verdict.ok) {
    throw new ValidationError("Invalid CSO", {
      errors: verdict.errors,
      warnings: verdict.warnings,
    });
  }

  // === Execute Publish ===
  try {
    const graph = getGraphAdapter();
    let revisionMetadata = null;

    // === Revision Permission Check ===
    if (supersedesId) {
      revisionMetadata = await validateRevisionPermission(graph, userId, viewer, supersedesId);
    }

    // === Graph Publish ===
    const result = await graph.publish({
      viewer: {
        id: userId,
        handle: viewer.email ?? viewer.name ?? null,
        displayName: viewer.name ?? null,
      },
      cso,
      clientId,
      supersedesId,
      revisionMetadata,
    });

    // === Post-Publish Side Effects (non-blocking) ===
    fireReplyNotification(cso, userId, result.assertionId);

    if (clearDraft) {
      clearUserDraft(userId);
    }

    // === Complete Idempotency Record ===
    if (idempotencyKey) {
      await completeIdempotencyRecord(idempotencyKey, userId, result.assertionId);
    }

    return {
      assertionId: result.assertionId,
      createdAt: result.createdAt,
    };
  } catch (error) {
    // Map Neo4j constraint violation to RevisionConflictError
    if (error.code === "Neo.ClientError.Schema.ConstraintValidationFailed" && supersedesId) {
      console.warn("[REVISION] Conflict: Assertion already revised", {
        userId,
        supersedesId,
        error: error.message,
      });
      logNearMiss("revision-conflict-race", {
        operation: "publish",
        userId,
        assertionId: supersedesId,
        message: "Concurrent revision detected",
      });
      throw new RevisionConflictError(supersedesId);
    }

    // Re-throw typed errors as-is
    if (error.code) {
      throw error;
    }

    // Capture unexpected errors
    console.error("Publish Error:", error);
    captureError(error, {
      operation: supersedesId ? "revision" : "publish",
      userId,
      assertionId: supersedesId,
    });
    throw error;
  }
}

/**
 * Handle idempotency check and potential reconciliation.
 *
 * @param {string} idempotencyKey
 * @param {string} userId
 * @returns {Promise<{ assertionId: string, createdAt: Date, replayed: true } | null>}
 *   Returns replay response if already complete, null if should proceed with publish
 * @throws {IdempotencyError} If pending record cannot be reconciled
 */
async function handleIdempotencyCheck(idempotencyKey, userId) {
  try {
    const existing = await getPublishByIdempotencyKey(idempotencyKey, userId);

    if (existing) {
      // Complete: replay success response
      if (existing.status === "complete") {
        console.info("[IDEMPOTENCY] Replaying existing publish:", {
          userId,
          idempotencyKey,
          assertionId: existing.assertionId,
        });
        return {
          assertionId: existing.assertionId,
          createdAt: existing.createdAt,
          replayed: true,
        };
      }

      // Pending: attempt reconciliation
      console.warn("[IDEMPOTENCY] Found pending record, attempting reconciliation:", {
        userId,
        idempotencyKey,
      });

      const reconciled = await reconcilePending(idempotencyKey, userId);
      if (reconciled) {
        console.info("[IDEMPOTENCY] Reconciliation succeeded:", {
          userId,
          idempotencyKey,
          assertionId: reconciled.assertionId,
        });
        return {
          assertionId: reconciled.assertionId,
          createdAt: reconciled.createdAt,
          replayed: true,
        };
      }

      // Reconciliation failed - cannot proceed
      throw new IdempotencyError(
        "Publish in progress (pending record found). Please retry later.",
        idempotencyKey
      );
    }

    // No existing record: create pending before graph write
    await createPendingIdempotency(idempotencyKey, userId);
    console.info("[IDEMPOTENCY] Created pending record:", {
      userId,
      idempotencyKey,
    });
    return null;
  } catch (error) {
    // Re-throw IdempotencyError
    if (error instanceof IdempotencyError) {
      throw error;
    }

    // Log other errors but continue with publish
    console.error("[IDEMPOTENCY] Check failed:", error);
    captureError(error, {
      operation: "idempotency-check",
      userId,
      idempotencyKey,
    });
    return null;
  }
}

/**
 * Validate revision permission and return metadata.
 *
 * @param {object} graph - Graph adapter
 * @param {string} userId - Viewer ID
 * @param {object} viewer - Full viewer object (for role extraction)
 * @param {string} supersedesId - ID of assertion being revised
 * @returns {Promise<{ revisionNumber: number, rootAssertionId: string }>}
 * @throws {NotFoundError} Original assertion not found
 * @throws {ConflictError} Already superseded
 * @throws {ForbiddenError} No permission to revise
 */
async function validateRevisionPermission(graph, userId, viewer, supersedesId) {
  const userRole = getUserRole(viewer);

  console.info("[REVISION] Attempt:", {
    viewerId: userId,
    role: userRole,
    supersedesId,
  });

  // Check if superseded assertion exists
  const originalAssertion = await graph.getAssertionForRevision(supersedesId);

  if (!originalAssertion) {
    console.warn("[REVISION] Denied: Original assertion not found", {
      viewerId: userId,
      supersedesId,
    });
    throw new NotFoundError("Original assertion");
  }

  // Check if already superseded (linear history)
  if (originalAssertion.supersedesId !== null) {
    console.warn("[REVISION] Denied: Already superseded", {
      viewerId: userId,
      supersedesId,
      existingSupersedes: originalAssertion.supersedesId,
    });
    throw new ConflictError("Cannot revise: Assertion has already been revised");
  }

  // Permission check
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
    throw new ForbiddenError("You do not have permission to revise this assertion");
  }

  console.info("[REVISION] Allowed:", {
    viewerId: userId,
    role: userRole,
    supersedesId,
  });

  return {
    revisionNumber: 1,
    rootAssertionId: supersedesId,
  };
}

/**
 * Fire reply notification (non-blocking).
 */
function fireReplyNotification(cso, userId, assertionId) {
  if (cso.assertionType !== ASSERTION_TYPES.RESPONSE) return;
  if (!Array.isArray(cso.refs) || cso.refs.length === 0) return;

  const parentAssertionId = extractAssertionIdFromRef(cso.refs[0]);
  if (!parentAssertionId) return;

  notifyReply({
    actorId: userId,
    replyAssertionId: assertionId,
    parentAssertionId,
  }).catch((err) => {
    console.error("[NOTIFICATION] Reply notification failed:", err);
    captureError(err, {
      operation: "notify-reply",
      userId,
      assertionId,
    });
  });
}

/**
 * Clear user draft (non-blocking).
 */
function clearUserDraft(userId) {
  deleteDraftForUser(userId).catch((e) => {
    console.warn("Publish succeeded but draft clear failed:", e);
  });
}

/**
 * Complete idempotency record after successful graph write.
 */
async function completeIdempotencyRecord(idempotencyKey, userId, assertionId) {
  try {
    await completeIdempotency(idempotencyKey, userId, assertionId);
    console.info("[IDEMPOTENCY] Completed pending record:", {
      userId,
      idempotencyKey,
      assertionId,
    });
  } catch (error) {
    console.error("[IDEMPOTENCY] Completion failed:", error);
    captureError(error, {
      operation: "idempotency-complete",
      userId,
      idempotencyKey,
      assertionId,
    });
    // Non-fatal: publish succeeded, pending record will expire
  }
}
