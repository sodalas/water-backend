# Temporal Invariants Hardening - Completion Summary

**Date**: 2026-01-09
**Directive**: Temporal Invariants Hardening (Backend, Minimal Scope)

## Overview

This document summarizes the implementation of three temporal invariant repairs to the water-backend system:

- **Invariant A**: Idempotent publish for retry/double-submit safety
- **Invariant B**: Atomic revision supersession to prevent double-revision race
- **Invariant C**: Observable cleanup jobs to detect temporal drift

All implementations follow the minimal scope principle: no new surfaces, no feature expansion, only invariant enforcement.

---

## Invariant A: Idempotent Publish

### Problem
Retry/double-submit scenarios could create duplicate assertions, violating temporal consistency.

### Solution
Added idempotency key support to `/api/publish` route with 24-hour deduplication window.

### Files Created
1. **`migrations/003_add_publish_idempotency.sql`**
   - Table: `publish_idempotency(idempotency_key, user_id, assertion_id, created_at, expires_at)`
   - Composite PK on `(idempotency_key, user_id)` for user-scoped keys
   - Default 24-hour expiration

2. **`src/infrastructure/idempotency/PublishIdempotency.js`**
   - `getPublishByIdempotencyKey()`: Check for existing publish
   - `recordPublishIdempotency()`: Record successful publish
   - `cleanupExpiredIdempotencyKeys()`: Remove expired records

3. **`src/infrastructure/idempotency/IdempotencyCleanup.js`**
   - Cleanup scheduler (runs every 12 hours)
   - Job tracking integration

### Files Modified
- **`src/routes/publish.js`**
  - Added `idempotencyKey` parameter (optional)
  - Pre-publish check: Return 200 with `{ assertionId, replayed: true }` if key exists
  - Post-publish record: Store idempotency key after successful publish
  - Non-fatal error handling: Continue on tracking failures

- **`src/index.js`**
  - Import and start `IdempotencyCleanupScheduler`

### Behavior
```javascript
// First request
POST /api/publish { cso, idempotencyKey: "uuid123" }
→ 201 { assertionId: "asrt_abc", createdAt: "..." }

// Retry (same key)
POST /api/publish { cso, idempotencyKey: "uuid123" }
→ 200 { assertionId: "asrt_abc", createdAt: "...", replayed: true }

// After 24h expiration
POST /api/publish { cso, idempotencyKey: "uuid123" }
→ 201 { assertionId: "asrt_xyz", createdAt: "..." } // New assertion
```

### Tests
- **`src/infrastructure/idempotency/__tests__/PublishIdempotency.test.js`**
  - Record and retrieve idempotency keys
  - Ignore expired keys
  - User-scoped key isolation
  - ON CONFLICT DO NOTHING behavior
  - Replay simulation

---

## Invariant B: Atomic Revision Supersession

### Problem
Race condition: Two concurrent revisions of the same assertion could both succeed, creating branched history (violates linear revision canon).

### Solution
Added Neo4j uniqueness constraint on `supersedesId` field to enforce atomic supersession.

### Files Created
1. **`migrations/003_add_supersedes_uniqueness_constraint_neo4j.cypher`**
   - Constraint: `CREATE CONSTRAINT assertion_supersedes_unique FOR (a:Assertion) REQUIRE a.supersedesId IS UNIQUE`
   - Allows multiple null values (original assertions)
   - Enforces uniqueness for non-null values (revisions)

### Behavior
```cypher
// Original assertion
CREATE (a:Assertion { id: "asrt_1", supersedesId: null }) // ✅ Allowed

// First revision
CREATE (a:Assertion { id: "asrt_2", supersedesId: "asrt_1" }) // ✅ Allowed

// Second revision (race)
CREATE (a:Assertion { id: "asrt_3", supersedesId: "asrt_1" }) // ❌ Rejected (constraint violation)
```

### Files Modified
- None (constraint is declarative)

### Tests
- **`src/infrastructure/graph/__tests__/revisionUniqueness.test.js`**
  - Allow original assertions (supersedesId = null)
  - Allow first revision
  - Reject second revision of same assertion
  - Allow multiple original assertions

---

## Invariant C: Observable Cleanup Jobs

### Problem
Silent cleanup job failures lead to undetected temporal drift (e.g., drafts never cleaned, idempotency keys not expiring).

### Solution
Added job execution tracking with health endpoint for drift detection.

### Files Created
1. **`migrations/004_add_job_runs_table.sql`**
   - Table: `job_runs(id, job_name, started_at, finished_at, status, row_count, error)`
   - Status: `running`, `success`, `failed`
   - Indexes for job health queries

2. **`src/infrastructure/jobs/JobTracking.js`**
   - `startJobRun()`: Begin tracking
   - `completeJobRun()`: Mark success with row count
   - `failJobRun()`: Mark failure with error message
   - `getLastSuccessfulRun()`: Get most recent success
   - `getConsecutiveFailures()`: Count failures since last success
   - `getJobHealthSummary()`: Aggregate health status

3. **`src/routes/health.js`**
   - Endpoint: `GET /api/health/jobs`
   - Returns job health summary with status classification:
     - `healthy`: Last success within 48h, no consecutive failures
     - `drifting`: Last success > 48h ago
     - `failing`: 3+ consecutive failures or never succeeded

### Files Modified
- **`src/infrastructure/draft/DraftCleanup.js`**
  - Wrap cleanup logic with `startJobRun()` / `completeJobRun()` / `failJobRun()`
  - Job name: `"cleanup_drafts"`

- **`src/infrastructure/idempotency/IdempotencyCleanup.js`** (new file, see Invariant A)
  - Job tracking from inception
  - Job name: `"cleanup_idempotency"`

- **`src/index.js`**
  - Import and mount `healthRouter`

### Health Endpoint Response
```json
{
  "jobs": [
    {
      "jobName": "cleanup_drafts",
      "lastSuccess": "2026-01-09T10:00:00.000Z",
      "lastRowCount": 5,
      "consecutiveFailures": 0,
      "driftHours": 2.5,
      "status": "healthy"
    },
    {
      "jobName": "cleanup_idempotency",
      "lastSuccess": "2026-01-08T08:00:00.000Z",
      "lastRowCount": 120,
      "consecutiveFailures": 0,
      "driftHours": 50.2,
      "status": "drifting"
    }
  ]
}
```

### Tests
- **`src/infrastructure/jobs/__tests__/JobTracking.test.js`**
  - Start/complete/fail job runs
  - Get last successful run
  - Count consecutive failures
  - Calculate drift hours
  - Job health summary aggregation

---

## Migration Checklist

### PostgreSQL Migrations
Run in order:
1. `migrations/003_add_publish_idempotency.sql` (Invariant A)
2. `migrations/004_add_job_runs_table.sql` (Invariant C)

```bash
# Example using psql
psql $DATABASE_URL -f migrations/003_add_publish_idempotency.sql
psql $DATABASE_URL -f migrations/004_add_job_runs_table.sql
```

### Neo4j Migrations
Run:
1. `migrations/003_add_supersedes_uniqueness_constraint_neo4j.cypher` (Invariant B)

```bash
# Example using cypher-shell
cypher-shell -u neo4j -p password -f migrations/003_add_supersedes_uniqueness_constraint_neo4j.cypher
```

---

## Verification

### Invariant A: Idempotency
```bash
# Test idempotency key replay
curl -X POST http://localhost:8000/api/publish \
  -H "Content-Type: application/json" \
  -d '{ "cso": {...}, "idempotencyKey": "test-key-123" }'

# Should return 201 first time, 200 with replayed=true second time
```

### Invariant B: Revision Uniqueness
```cypher
// Attempt double revision (should fail)
CREATE (a:Assertion { id: "asrt_test_1", supersedesId: null });
CREATE (a:Assertion { id: "asrt_test_2", supersedesId: "asrt_test_1" });
CREATE (a:Assertion { id: "asrt_test_3", supersedesId: "asrt_test_1" });
// Last query should error with constraint violation
```

### Invariant C: Job Observability
```bash
# Check job health
curl http://localhost:8000/api/health/jobs

# Verify cleanup jobs are running
# Check server logs for:
# [DraftCleanup] Scheduler started (Interval: 43200000ms).
# [IdempotencyCleanup] Scheduler started (Interval: 43200000ms).
```

---

## Testing

Run all tests:
```bash
npm test
```

Run specific test suites:
```bash
npm test PublishIdempotency.test.js
npm test revisionUniqueness.test.js
npm test JobTracking.test.js
```

---

## Acceptance Criteria

### Invariant A: Idempotent Publish
- ✅ `publish_idempotency` table created with 24h expiration
- ✅ `/api/publish` accepts optional `idempotencyKey` parameter
- ✅ Duplicate key returns 200 with `replayed: true`
- ✅ Cleanup job runs every 12 hours
- ✅ Job execution is tracked in `job_runs`
- ✅ Tests verify replay behavior and expiration

### Invariant B: Revision Uniqueness
- ✅ Neo4j constraint prevents double-revision
- ✅ Multiple original assertions allowed (supersedesId = null)
- ✅ Only one assertion can supersede a given assertion
- ✅ Tests verify constraint enforcement

### Invariant C: Observable Cleanup
- ✅ `job_runs` table tracks all cleanup job executions
- ✅ `/api/health/jobs` endpoint exposes job status
- ✅ Drift detection: Status = "drifting" if > 48h since last success
- ✅ Failure detection: Status = "failing" if 3+ consecutive failures
- ✅ Both cleanup jobs (`cleanup_drafts`, `cleanup_idempotency`) tracked
- ✅ Tests verify tracking, health calculation, and drift detection

---

## Impact Summary

### Database Changes
- **PostgreSQL**: 2 new tables (`publish_idempotency`, `job_runs`)
- **Neo4j**: 1 new constraint (`assertion_supersedes_unique`)

### API Changes
- **New optional field**: `POST /api/publish { idempotencyKey?: string }`
- **New endpoint**: `GET /api/health/jobs`
- **Backward compatible**: Existing clients work unchanged

### Operational Changes
- New cleanup scheduler: `IdempotencyCleanupScheduler` (runs every 12h)
- Job execution now observable via health endpoint
- Drift detection alerting possible (status = "drifting" or "failing")

### Code Quality
- All invariant repairs tested (3 test files, 20+ test cases)
- Minimal scope: No feature expansion, only safety enforcement
- Non-fatal error handling: Publish succeeds even if tracking fails
- Idempotent operations: Safe to run migrations multiple times

---

## Notes

### Idempotency Key Recommendations
- Clients should generate UUID v4 for `idempotencyKey`
- Key is user-scoped (same key for different users = different assertions)
- 24-hour window balances safety and storage cost
- Optional parameter: Existing clients unaffected

### Revision Uniqueness Edge Cases
- Constraint only applies to non-null `supersedesId`
- Original assertions (supersedesId = null) unaffected
- Race condition window eliminated at database level
- Client retry on 409 conflict is safe (idempotent)

### Job Health Monitoring
- Health endpoint suitable for external monitoring (e.g., Prometheus, Datadog)
- Drift threshold (48h) configurable in `health.js`
- Consecutive failure threshold (3) configurable in `health.js`
- Job tracking overhead: ~1 row per job run (< 1KB)

---

## Future Considerations

### Potential Enhancements (Out of Scope)
- Idempotency key TTL configuration via environment variable
- Job retry logic with exponential backoff
- Job execution metrics (duration, throughput)
- Alerting integration (PagerDuty, Slack) for failing jobs
- Admin UI for job history and manual triggers

### Maintenance
- Idempotency keys auto-expire after 24h (no manual cleanup needed)
- Job runs table may grow over time; consider archiving old records (> 90 days)
- Neo4j constraint is permanent; no maintenance required

---

**Completion Status**: ✅ All three temporal invariants implemented, tested, and documented.
