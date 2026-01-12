// Sentry initialization for water-backend
// IMPORTANT: This file must be imported at the very top of index.js, before any other imports
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://47e9fa36f0477573caf54646a26c8373@o4510693980045312.ingest.us.sentry.io/4510697323626496",
  environment: process.env.NODE_ENV || "development",
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  initialScope: {
    tags: {
      phase: "E.0-stabilization",
    },
  },
});

/**
 * Set user context for Sentry from auth session
 * Call this in auth middleware after user is authenticated
 */
export function setSentryUser(user) {
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.name || user.handle,
  });
}

/**
 * Capture exception with contextual metadata
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context
 * @param {string} context.route - The route/endpoint
 * @param {string} context.userId - User ID if available
 * @param {string} context.assertionId - Assertion ID if applicable
 * @param {string} context.operation - Operation being performed (publish, delete, etc.)
 * @param {string} context.level - Sentry level (error, warning, info)
 */
export function captureError(error, context = {}) {
  const { route, userId, assertionId, operation, level = "error", ...extra } = context;

  Sentry.withScope((scope) => {
    if (route) scope.setTag("route", route);
    if (operation) scope.setTag("operation", operation);
    if (userId) scope.setUser({ id: userId });
    if (assertionId) scope.setContext("assertion", { assertionId });
    if (Object.keys(extra).length > 0) scope.setContext("extra", extra);
    scope.setLevel(level);
    Sentry.captureException(error);
  });
}

/**
 * Log a near-miss invariant violation
 * These are not errors but represent unexpected states that should be monitored
 * @param {string} invariant - Name of the invariant that was nearly violated
 * @param {Object} context - Contextual information
 */
export function logNearMiss(invariant, context = {}) {
  const { route, userId, assertionId, ...extra } = context;

  const message = `[NEAR-MISS] ${invariant}`;

  // Always log to console in dev
  console.warn(message, context);

  // Report to Sentry as warning
  Sentry.withScope((scope) => {
    scope.setTag("type", "near-miss");
    scope.setTag("invariant", invariant);
    if (route) scope.setTag("route", route);
    if (userId) scope.setUser({ id: userId });
    if (assertionId) scope.setContext("assertion", { assertionId });
    if (Object.keys(extra).length > 0) scope.setContext("extra", extra);
    scope.setLevel("warning");
    Sentry.captureMessage(message);
  });
}

/**
 * Add breadcrumb for critical operations
 * @param {string} category - Category of the breadcrumb
 * @param {string} message - Breadcrumb message
 * @param {Object} data - Additional data
 */
export function addBreadcrumb(category, message, data = {}) {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: "info",
  });
}

export { Sentry };
