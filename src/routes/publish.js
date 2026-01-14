// src/routes/publish.js
// Phase F.1: Thin route - auth + input parsing + delegation to PublishService
import { Router } from "express";
import { publish } from "../services/PublishService.js";
import { captureError } from "../sentry.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  IdempotencyError,
  RevisionConflictError,
  AppError,
} from "../domain/errors/AppError.js";

const router = Router();

/**
 * POST /publish
 * Body: { cso: <ComposerStateObject>, clientId?: string, clearDraft?: boolean, supersedesId?: string, idempotencyKey?: string }
 *
 * Route is thin: auth + input parsing + delegation + error mapping
 * All orchestration lives in PublishService.
 */
router.post("/publish", async (req, res) => {
  // === Auth Extraction ===
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // === Input Parsing ===
  const cso = req.body?.cso;
  const clientId = req.body?.clientId;
  const clearDraft = req.body?.clearDraft === true;
  const supersedesId = req.body?.supersedesId;
  const idempotencyKey = req.body?.idempotencyKey;

  // === Delegate to PublishService ===
  try {
    const result = await publish({
      viewer: req.user,
      cso,
      clientId,
      clearDraft,
      supersedesId,
      idempotencyKey,
    });

    // Determine status code: 200 for replay, 201 for new publish
    const statusCode = result.replayed ? 200 : 201;

    return res.status(statusCode).json({
      assertionId: result.assertionId,
      createdAt: result.createdAt,
      ...(result.replayed && { replayed: true }),
    });
  } catch (error) {
    // === Error Mapping (typed errors to HTTP responses) ===
    return mapErrorToResponse(error, res, userId, supersedesId);
  }
});

/**
 * Map AppError subclasses to appropriate HTTP responses.
 * Preserves exact response shapes from original route for backwards compatibility.
 */
function mapErrorToResponse(error, res, userId, supersedesId) {
  // Validation errors
  if (error instanceof ValidationError) {
    return res.status(400).json({
      error: "Invalid CSO",
      details: error.details.errors,
      warnings: error.details.warnings,
    });
  }

  // Not found (original assertion for revision)
  if (error instanceof NotFoundError) {
    return res.status(404).json({
      error: "Cannot revise: Original assertion not found",
    });
  }

  // Forbidden (no permission to revise)
  if (error instanceof ForbiddenError) {
    return res.status(403).json({
      error: "Forbidden: You do not have permission to revise this assertion",
    });
  }

  // Revision conflict (already superseded)
  if (error instanceof RevisionConflictError) {
    return res.status(409).json({
      error: "This assertion has already been revised or deleted.",
    });
  }

  // Generic conflict (already revised when attempting revision)
  if (error instanceof ConflictError) {
    return res.status(409).json({
      error: error.message,
    });
  }

  // Idempotency error (pending record found)
  if (error instanceof IdempotencyError) {
    return res.status(409).json({
      error: error.message,
    });
  }

  // Generic AppError
  if (error instanceof AppError) {
    return res.status(error.status).json(error.toJSON());
  }

  // Unexpected error
  console.error("Publish Error:", error);
  captureError(error, {
    route: "/publish",
    operation: supersedesId ? "revision" : "publish",
    userId,
    assertionId: supersedesId,
  });
  return res.status(500).json({ error: "Internal Publish Error" });
}

export default router;
