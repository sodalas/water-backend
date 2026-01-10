# Legacy deletedAt Migration Plan

**Date**: 2026-01-10
**Phase**: B3.5-B (Canon B Finalization)

## Context

Phase B3.4-A replaced in-place deletion (`SET a.deletedAt = $deletedAt`) with Canon B tombstone supersession. The new implementation:

- Creates tombstone assertion (`assertionType: "tombstone"`)
- Links via `SUPERSEDES` edge (`supersedesId`)
- Filters tombstones in projection layer

However, the database **may contain** assertions with `deletedAt != null` from before Phase B3.4-A was deployed.

## Problem

**Current State**:
- New code doesn't set or check `deletedAt`
- Old deleted assertions (with `deletedAt != null`) will **reappear in feeds**

**Invariant Violation**:
- Canon B requires: "Deleted assertions are hidden via tombstone supersession"
- Legacy deletedAt assertions violate this (no tombstone, just a field)

## Decision: Option 1 - Immediate Migration Script

**Chosen Approach**: Create migration script to convert legacy deletedAt assertions to tombstone supersessions.

### Why This Option?

1. **Clean canonical state**: After migration, database fully conforms to Canon B
2. **No technical debt**: No dual guard logic cluttering projection/query code
3. **One-time cost**: Migration runs once, then forgotten
4. **Auditability**: Full tombstone history for all deleted assertions

### Migration Script Specification

**File**: `migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher`

**Logic**:
```cypher
// Find all assertions with deletedAt IS NOT NULL
MATCH (deleted:Assertion)
WHERE deleted.deletedAt IS NOT NULL
  AND NOT EXISTS {
    MATCH (newer:Assertion)
    WHERE newer.supersedesId = deleted.id
  }
WITH deleted

// For each, create a tombstone that supersedes it
CREATE (tombstone:Assertion {
  id: 'tomb_legacy_' + deleted.id,
  assertionType: 'tombstone',
  text: '',
  createdAt: deleted.deletedAt,  // Use deletedAt as tombstone creation time
  visibility: 'public',
  media: '[]',
  supersedesId: deleted.id,
  revisionNumber: null,
  rootAssertionId: null,
  originPublicationId: null,
  title: null
})

// Link tombstone to same author
WITH deleted, tombstone
MATCH (deleted)-[:AUTHORED_BY]->(author:Identity)
CREATE (tombstone)-[:AUTHORED_BY]->(author)

// Remove deletedAt field (cleanup)
REMOVE deleted.deletedAt

RETURN count(tombstone) as tombstonesCreated;
```

**Safety Checks**:
- Only creates tombstones for assertions **not already superseded** (prevents double-supersession)
- Uses `deletedAt` timestamp as tombstone `createdAt` (preserves deletion timing)
- Links tombstone to original author (preserves ownership)
- Removes `deletedAt` field after migration (cleanup)

### Rollout Plan

**1. Pre-migration audit**:
```cypher
// Count legacy deleted assertions
MATCH (a:Assertion)
WHERE a.deletedAt IS NOT NULL
RETURN count(a) as legacyDeletedCount;
```

**2. Run migration**:
```bash
cd water-backend
cat migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher | \
  docker exec -i neo4j cypher-shell -u neo4j -p <password>
```

**3. Post-migration verification**:
```cypher
// Verify no deletedAt fields remain
MATCH (a:Assertion)
WHERE a.deletedAt IS NOT NULL
RETURN count(a);  // Should be 0

// Verify tombstones created
MATCH (tomb:Assertion {assertionType: 'tombstone'})
WHERE tomb.id STARTS WITH 'tomb_legacy_'
RETURN count(tomb);  // Should match pre-migration count
```

**4. Feed verification**:
- Load feed, confirm legacy deleted assertions do not appear
- Check history endpoint for migrated assertions (should show tombstone)

### Alternative Considered: Option 2 - Temporary Dual Guard

**Rejected because**:
- Adds complexity to every feed query
- Creates two "kinds" of deletion (tombstone vs deletedAt)
- Technical debt that could persist indefinitely
- Harder to reason about in future (why is deletedAt check there?)

**Example rejected approach**:
```cypher
// In feed query (Phase B2)
WHERE NOT EXISTS {
  MATCH (newer:Assertion)
  WHERE newer.supersedesId = a.id
}
AND a.deletedAt IS NULL  // ❌ Dual guard - rejected
```

## Canonical State After Migration

**Invariant**: All deleted assertions are represented by tombstone supersessions

**No deletedAt fields**: The `deletedAt` property does not exist on any Assertion node

**History**: Full lineage preserved via tombstones (original → tombstone)

**Feeds**: Projection layer filters tombstones via `assertionType !== 'tombstone'` check

## Migration Timeline

**Immediate**: Run migration before Phase B3.5 is considered complete

**Dependencies**: None (migration is backward compatible)

**Rollback**: If migration fails, tombstones can be deleted and deletedAt restored from backup

## Completion Criteria

- [ ] Migration script created in `migrations/004_convert_deleted_at_to_tombstones_neo4j.cypher`
- [ ] Pre-migration audit run (count of legacy deletions)
- [ ] Migration executed in production database
- [ ] Post-migration verification passed (0 deletedAt, N tombstones)
- [ ] Feed verification confirms deleted assertions hidden
- [ ] `deletedAt` property never used in codebase (grep verification)

---

## Canonical Decision

**Legacy deletedAt is handled via immediate migration to tombstone supersessions.**

This migration runs once, converting all `deletedAt != null` assertions to proper Canon B tombstones, then removes the `deletedAt` field entirely.

After migration, the system has **one canonical delete mechanism**: tombstone supersession.
