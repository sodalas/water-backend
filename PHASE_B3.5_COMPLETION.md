# Phase B3.5 (Canon B Finalization: Supersedes Uniqueness + Legacy deletedAt Migration) - Completion Summary

**Date**: 2026-01-10
**Directive**: Canon B Finalization - Ensure global uniqueness and handle legacy deletions

## Overview

Phase B3.5 finalizes Canon B implementation by:

1. **SupersedesId Global Uniqueness**: Verified Neo4j constraint prevents double-revision, double-delete, and revision-delete races
2. **Legacy deletedAt Migration**: Created migration plan and script to convert legacy soft deletes to tombstone supersessions

This phase ensures the system has **one canonical delete mechanism** (tombstone supersession) and **linear revision history** (no branching).

---

## B3.5-A: SupersedesId Global Uniqueness (Hard Requirement)

### Verification

**Constraint File**: `migrations/003_add_supersedes_uniqueness_constraint_neo4j.cypher`

```cypher
CREATE CONSTRAINT assertion_supersedes_unique IF NOT EXISTS
FOR (a:Assertion)
REQUIRE a.supersedesId IS UNIQUE;
```

**What This Enforces**:
- ✅ **No double-revision**: Only one assertion can have `supersedesId = "asrt_abc"`
- ✅ **No double-delete**: Only one tombstone can supersede a given assertion
- ✅ **No revision-then-delete race**: If revision wins, delete gets constraint violation (and vice versa)
- ✅ **Linear history**: Revision chains cannot branch

**Applies To**:
- Regular revisions (`assertionType: "assertion"` with `supersedesId`)
- Tombstone deletions (`assertionType: "tombstone"` with `supersedesId`)

**Null Values**:
- Multiple assertions can have `supersedesId = null` (original assertions)
- Constraint only applies to non-null values

### Race Condition Handling

**Scenario 1: Double-Revision (Concurrent Edits)**:
```
User A: Clicks "Edit" on asrt_v1 at 12:00:00
User B: Clicks "Edit" on asrt_v1 at 12:00:01
Both submit: supersedesId = "asrt_v1"

Result:
- First write (A) succeeds → creates asrt_v2
- Second write (B) fails → Neo4j constraint violation
- User B sees error: "This assertion has already been revised"
```

**Scenario 2: Delete-Then-Revise Race**:
```
User clicks "Delete" and "Edit" simultaneously
Both create assertions with supersedesId = "asrt_target"

Result:
- Whichever completes first wins (e.g., tombstone created)
- Other operation fails with constraint violation
- User sees error message, retries if needed
```

**Scenario 3: Revise-Then-Delete Race**:
```
User A: Revises asrt_v1 → creates asrt_v2 (supersedesId = "asrt_v1")
User B: Deletes asrt_v1 → tries to create tombstone (supersedesId = "asrt_v1")

Result:
- Revision succeeds
- Delete fails (constraint violation)
- Correct outcome: Cannot delete already-revised assertion
```

### Tests

**File**: `src/domain/feed/__tests__/Projection.canonB.test.js`

**Test Coverage**:
1. ✅ Prevent duplicate supersession (double-revision conflict)
2. ✅ Prevent tombstone-revision conflict (delete-then-revise race)
3. ✅ Allow multiple null supersedesIds (original assertions)
4. ✅ Enforce linear revision history (no branching)
5. ✅ Detect branching violations

### Canonical Decision

**Supersedes uniqueness applies globally to all assertions, including tombstones.**

The Neo4j constraint `assertion_supersedes_unique` ensures that:
- Each assertion can be superseded by **at most one** other assertion
- Revision history is always **linear** (no branching)
- Race conditions between revise/delete operations are handled deterministically

---

## B3.5-B: Legacy deletedAt Migration

### Problem

Before Phase B3.4-A, assertions were soft-deleted via in-place mutation:
```javascript
SET a.deletedAt = $timestamp  // ❌ Violates Canon B immutability
```

Phase B3.4-A replaced this with tombstone supersession, but the database **may contain** assertions with `deletedAt != null` from before the change.

**Issue**: Without migration, these legacy deleted assertions will **reappear in feeds** (new code doesn't check `deletedAt`).

### Solution: Immediate Migration Script

**Chosen Approach**: Option 1 - Convert all legacy deletedAt assertions to tombstone supersessions

**Why Not Dual Guard (Option 2)**:
- Dual guard adds complexity to every feed query
- Creates two "kinds" of deletion (confusing)
- Technical debt that could persist indefinitely
- Harder to audit and reason about

### Migration Plan

**Document**: `LEGACY_DELETED_AT_MIGRATION_PLAN.md`

**Migration Script**: `migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher`

**Logic**:
1. Find all assertions with `deletedAt IS NOT NULL`
2. Check if already superseded (skip if yes)
3. Create tombstone assertion:
   - `assertionType: "tombstone"`
   - `supersedesId: <deleted assertion ID>`
   - `createdAt: <deletedAt timestamp>` (preserves deletion timing)
   - Link to same author
4. Remove `deletedAt` field from original assertion (cleanup)

**Example**:
```cypher
// Before migration
(a:Assertion {id: "asrt_123", text: "Hello", deletedAt: "2024-01-01T10:00:00Z"})

// After migration
(a:Assertion {id: "asrt_123", text: "Hello"})  // deletedAt removed
(tomb:Assertion {
  id: "tomb_legacy_asrt_123",
  assertionType: "tombstone",
  supersedesId: "asrt_123",
  createdAt: "2024-01-01T10:00:00Z"
})-[:AUTHORED_BY]->(author)
```

### Safety Guarantees

**Idempotency**: Migration can be run multiple times safely
- Checks for existing supersession before creating tombstone
- Uses `IF NOT EXISTS` pattern

**Preservation**:
- ✅ Deletion timestamp preserved (deletedAt → tombstone.createdAt)
- ✅ Author ownership preserved (tombstone links to same author)
- ✅ Full history preserved (original + tombstone in graph)

**Cleanup**:
- ✅ Removes `deletedAt` field after migration
- ✅ No orphaned data

### Verification Plan

**Pre-migration audit**:
```cypher
MATCH (a:Assertion)
WHERE a.deletedAt IS NOT NULL
RETURN count(a) as legacyDeletedCount;
```

**Post-migration verification**:
```cypher
// 1. No deletedAt fields remain
MATCH (a:Assertion)
WHERE a.deletedAt IS NOT NULL
RETURN count(a);  // Should be 0

// 2. Tombstones created
MATCH (tomb:Assertion {assertionType: 'tombstone'})
WHERE tomb.id STARTS WITH 'tomb_legacy_'
RETURN count(tomb);  // Should match pre-migration count

// 3. All legacy tombstones have correct structure
MATCH (tomb:Assertion {assertionType: 'tombstone'})
      -[:AUTHORED_BY]->(author:Identity)
WHERE tomb.id STARTS WITH 'tomb_legacy_'
RETURN tomb.id, tomb.supersedesId, author.handle;
```

**Feed verification**:
- Load feed, confirm legacy deleted assertions do not appear
- Check history endpoint for migrated assertions (should show tombstone)

### Canonical Decision

**Legacy deletedAt is handled via immediate migration to tombstone supersessions.**

After migration:
- ✅ All deleted assertions represented by tombstones
- ✅ No `deletedAt` property exists on any Assertion node
- ✅ One canonical delete mechanism: tombstone supersession
- ✅ Full history preserved for all deletions

---

## Files Created/Modified

### New Files

1. **`LEGACY_DELETED_AT_MIGRATION_PLAN.md`** - Detailed migration plan document
2. **`migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher`** - Migration script
3. **`PHASE_B3.5_COMPLETION.md`** (this file) - Completion summary

### Modified Files

4. **`src/domain/feed/__tests__/Projection.canonB.test.js`**
   - Added B3.5-A test suite for supersedes uniqueness (5 tests)

### Existing Files (Verified)

5. **`migrations/003_add_supersedes_uniqueness_constraint_neo4j.cypher`**
   - Verified constraint syntax correct
   - Applies globally to all assertions (revisions + tombstones)

---

## Acceptance Checklist

### SupersedesId Uniqueness

- ✅ **Neo4j constraint verified**
  - `assertion_supersedes_unique` exists
  - Applies to all Assertion nodes
  - Enforces uniqueness on non-null `supersedesId`

- ✅ **Prevents double-revision**
  - Concurrent revisions of same assertion: one succeeds, one fails
  - Constraint violation error returned

- ✅ **Prevents double-delete**
  - Concurrent deletes of same assertion: one succeeds, one fails
  - Only one tombstone can supersede a target

- ✅ **Handles revision-delete races**
  - Whichever operation completes first wins
  - Other operation fails with constraint violation
  - Deterministic outcome

- ✅ **Enforces linear history**
  - Revision chains cannot branch
  - Each assertion has at most one superseder

### Legacy deletedAt Migration

- ✅ **Migration plan documented**
  - `LEGACY_DELETED_AT_MIGRATION_PLAN.md` created
  - Option 1 (immediate migration) chosen
  - Rationale documented

- ✅ **Migration script created**
  - `migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher`
  - Idempotent (can run multiple times)
  - Safe (checks for existing supersession)

- ✅ **Verification plan defined**
  - Pre-migration audit query
  - Post-migration verification queries
  - Feed verification steps

- ✅ **Canonical decision stated**
  - "Legacy deletedAt handled via immediate migration"
  - One delete mechanism: tombstone supersession
  - No dual guard in production code

---

## Testing

### Unit Tests

**File**: `src/domain/feed/__tests__/Projection.canonB.test.js`

**New Test Suite**: "B3.5-A: SupersedesId uniqueness enforcement"

**Tests**:
1. Prevent duplicate supersession (double-revision conflict)
2. Prevent tombstone-revision conflict (delete-then-revise race)
3. Allow multiple null supersedesIds (original assertions)
4. Enforce linear revision history (no branching)
5. Detect branching violations

**Run Tests**:
```bash
npm test Projection.canonB.test.js
```

### Manual Testing

**Test Migration Script**:
```bash
# 1. Create test assertions with deletedAt
# (Use Neo4j Browser or cypher-shell)

# 2. Run pre-migration audit
cat migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher | \
  docker exec -i neo4j cypher-shell -u neo4j -p <password>

# 3. Verify tombstones created
# (Check count matches pre-migration audit)

# 4. Check feed - deleted assertions should NOT appear

# 5. Check history endpoint - should show tombstone in lineage
```

**Test Uniqueness Constraint**:
```bash
# 1. Create assertion asrt_test
# 2. Try to create two revisions with same supersedesId
# Expected: Second one fails with constraint violation

# Example Cypher:
CREATE (a:Assertion {id: 'asrt_test', text: 'Original'})
CREATE (r1:Assertion {id: 'asrt_rev1', supersedesId: 'asrt_test'})  // ✅ Succeeds
CREATE (r2:Assertion {id: 'asrt_rev2', supersedesId: 'asrt_test'})  // ❌ Fails
```

---

## Migration Execution Checklist

### Pre-deployment

- [ ] Review `LEGACY_DELETED_AT_MIGRATION_PLAN.md`
- [ ] Review `migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher`
- [ ] Run pre-migration audit (count legacy deletions)
- [ ] Create database backup (rollback insurance)

### Deployment

- [ ] Deploy Phase B3.4 code (tombstone delete logic)
- [ ] Run uniqueness constraint migration (003)
- [ ] Run deletedAt migration (004)
- [ ] Run post-migration verification queries

### Post-deployment

- [ ] Verify no assertions have `deletedAt` property
- [ ] Verify tombstone count matches pre-migration audit
- [ ] Test feed loading (deleted assertions hidden)
- [ ] Test history endpoint (shows tombstones)
- [ ] Monitor logs for constraint violations (indicates race conditions)

---

## Canonical Decisions Summary

### 1. Supersedes Uniqueness

**Decision**: Global uniqueness constraint on `supersedesId` applies to all assertions (revisions and tombstones).

**Mechanism**: Neo4j constraint `assertion_supersedes_unique`

**Enforcement**: Database-level (constraint violation on duplicate)

**Scope**: All Assertion nodes, non-null `supersedesId` values only

### 2. Legacy deletedAt Handling

**Decision**: Immediate migration to tombstone supersessions (Option 1)

**Mechanism**: Migration script `004_convert_deleted_at_to_tombstones_neo4j.cypher`

**Outcome**: After migration, `deletedAt` property does not exist on any Assertion node

**Canonical Delete**: Tombstone supersession is the **only** delete mechanism

---

## Completion Status

✅ **Phase B3.5 complete**:
- SupersedesId global uniqueness verified (existing constraint correct)
- Legacy deletedAt migration plan created and documented
- Migration script created and tested
- Canonical decisions stated explicitly

**Invariants Maintained**:
- ✅ Assertions are immutable (no in-place mutation)
- ✅ Each assertion has at most one superseder (uniqueness constraint)
- ✅ Feeds show only heads (projection layer filtering)
- ✅ Deletion via tombstone supersession (Canon B compliant)

**Guardrails Maintained**:
- ✅ No new user-facing surfaces
- ✅ No permission system expansion
- ✅ No dual delete mechanisms (migration unifies to tombstones)

Phase B3.5 successfully finalizes Canon B with global uniqueness enforcement and canonical deletedAt handling.

---

## Next Steps (Out of Scope)

### Future Enhancements

1. **Monitor constraint violations**:
   - Add logging when uniqueness constraint fails
   - Surface user-friendly error messages ("This post has already been revised")

2. **Tombstone garbage collection**:
   - Scheduled job to archive old tombstones
   - Retention policy (e.g., keep 90 days, then archive)

3. **Admin undelete**:
   - Remove tombstone supersession
   - Restore original assertion to feed

4. **Migration metrics**:
   - Track how many legacy deletions existed
   - Dashboard showing tombstone creation over time

---

## Appendix: Constraint Verification Query

```cypher
// Verify uniqueness constraint exists
SHOW CONSTRAINTS
YIELD name, type, entityType, labelsOrTypes, properties
WHERE name = 'assertion_supersedes_unique'
RETURN *;

// Expected output:
// name: assertion_supersedes_unique
// type: UNIQUENESS
// entityType: NODE
// labelsOrTypes: ["Assertion"]
// properties: ["supersedesId"]
```

## Appendix: Legacy deletedAt Count Query

```cypher
// Count assertions with deletedAt (before migration)
MATCH (a:Assertion)
WHERE a.deletedAt IS NOT NULL
RETURN count(a) as legacyDeletedCount,
       collect(a.id)[0..10] as sampleIds;

// Example output:
// legacyDeletedCount: 42
// sampleIds: ["asrt_123", "asrt_456", ...]
```
