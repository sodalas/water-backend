# Near-Miss Instrumentation Inventory

This document catalogs all near-miss instrumentation points in the Water backend. Near-misses are unexpected states that fail safely but invisibly - they don't cause errors, but may indicate semantic drift or edge cases worth monitoring.

## Purpose

Near-miss logging via `logNearMiss()` sends Sentry warnings (not errors) that:
- Track frequency of unexpected states
- Enable early detection of semantic drift
- Provide debugging context without breaking the system

## Near-Miss Inventory

| Invariant Name | File | What It Detects | Phase Added |
|----------------|------|-----------------|-------------|
| `feed-root-purity-violation` | `domain/feed/Projection.js` | Response items appearing in home feed (should only be roots) | v1.0 (02-01) |
| `notification-outbox-backlog` | `domain/notifications/DeliveryService.js` | Outbox depth exceeds threshold (delivery lag) | v1.0 (02-01) |
| `reply-to-missing-parent` | `infrastructure/graph/Neo4jGraphAdapter.js` | Reply targets a parent that doesn't exist in graph | v1.0 |
| `reply-to-tombstoned` | `infrastructure/graph/Neo4jGraphAdapter.js` | Reply targets a tombstoned (deleted) parent | v1.0 |
| `notification-parent-not-found` | `domain/notifications/NotificationService.js` | Notification references non-existent parent assertion | v1.0 |
| `notification-parent-superseded` | `domain/notifications/NotificationService.js` | Notification references superseded parent assertion | v1.0 |
| `reaction-on-superseded` | `routes/reactions.js` | User attempted to react to superseded assertion | v1.0 |
| `reaction-on-tombstoned` | `routes/reactions.js` | User attempted to react to deleted assertion | v1.0 |
| `revision-conflict-race` | `services/PublishService.js` | Concurrent revision created race condition | v1.0 |
| `delete-conflict-race` | `routes/assertions.js` | Concurrent delete created race condition | v1.0 |
| `thread-empty-responses` | `routes/thread.js` | Thread query returned no responses (possible graph issue) | v1.0 |
| `role-fallback-to-user` | `domain/permissions/RevisionPermissions.js` | Invalid/unknown role fell back to 'user' | v1.1 (03-01) |
| `reaction-remove-already-absent` | `routes/reactions.js` | Reaction removal found nothing to remove (idempotent no-op) | v1.1 (03-01) |

## Usage Pattern

```javascript
import { logNearMiss } from "../../sentry.js";

// When detecting an unexpected-but-safe state:
logNearMiss("invariant-name", {
  // Always include route if in a route handler
  route: "/api/path",
  // Always include userId if available
  userId: user?.id,
  // Include domain-specific context
  assertionId,
  additionalContext: value,
});
```

## Guidelines for Adding New Near-Misses

1. **When to add:**
   - System handles an unexpected input gracefully (fallback behavior)
   - An edge case is expected but worth monitoring frequency
   - A race condition is safely resolved but should be tracked
   - Data is in an unexpected state but doesn't break functionality

2. **When NOT to add:**
   - Expected success paths (don't log normal behavior)
   - Actual errors (use `captureError()` instead)
   - User errors (invalid input, auth failures - these are expected)

3. **Naming convention:**
   - Use kebab-case: `invariant-name`
   - Be descriptive: `reaction-on-superseded` not just `superseded`
   - Include the domain: `notification-parent-not-found` not just `parent-not-found`

4. **Context requirements:**
   - Always include `route` for route handlers
   - Always include `userId` when available
   - Include enough context to investigate (IDs, types, counts)
   - Cap array contexts to prevent huge payloads: `.slice(0, 10)`

5. **After adding:**
   - Update this inventory
   - Add a comment above the `logNearMiss()` call explaining what it detects

---

*Last updated: v1.1 Phase 3 (2026-01-17)*
