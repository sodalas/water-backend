// Phase E.0: Typed error objects for explicit, diagnosable failures
// These replace generic Error objects for business logic errors

/**
 * Base class for all application errors
 * Provides structured error info for Sentry and API responses
 */
export class AppError extends Error {
  constructor(
    message,
    { code, status = 500, details = {} } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

/**
 * 400 Bad Request - Invalid input or malformed request
 */
export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, { code: "VALIDATION_ERROR", status: 400, details });
  }
}

/**
 * 401 Unauthorized - No valid authentication
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { code: "UNAUTHORIZED", status: 401 });
  }
}

/**
 * 403 Forbidden - Authenticated but not permitted
 */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, { code: "FORBIDDEN", status: 403 });
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, { code: "NOT_FOUND", status: 404 });
  }
}

/**
 * 409 Conflict - Resource state prevents operation
 */
export class ConflictError extends AppError {
  constructor(message = "Resource has been modified", details = {}) {
    super(message, { code: "CONFLICT", status: 409, details });
  }
}

/**
 * Revision-specific conflict (assertion already superseded)
 */
export class RevisionConflictError extends ConflictError {
  constructor(assertionId) {
    super("This assertion has already been revised or deleted.", {
      assertionId,
      type: "revision_conflict",
    });
  }
}

/**
 * 410 Gone - Resource existed but has been deleted
 * Phase F.2: Used for tombstoned assertions
 */
export class GoneError extends AppError {
  constructor(message = "Resource has been deleted", details = {}) {
    super(message, { code: "GONE", status: 410, details });
  }
}

/**
 * 500 Internal Server Error - Unexpected failure
 */
export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred") {
    super(message, { code: "INTERNAL_ERROR", status: 500 });
  }
}

/**
 * Graph operation failed
 */
export class GraphError extends AppError {
  constructor(operation, originalError) {
    super(`Graph operation failed: ${operation}`, {
      code: "GRAPH_ERROR",
      status: 500,
      details: {
        operation,
        originalMessage: originalError?.message,
      },
    });
    this.originalError = originalError;
  }
}

/**
 * Idempotency check failure
 */
export class IdempotencyError extends AppError {
  constructor(message, idempotencyKey) {
    super(message, {
      code: "IDEMPOTENCY_ERROR",
      status: 409,
      details: { idempotencyKey },
    });
  }
}
