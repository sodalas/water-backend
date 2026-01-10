// Migration 004: Convert legacy deletedAt to tombstone supersessions
// Phase B3.5-B: Canon B Finalization - deletedAt migration
//
// Context:
// Before Phase B3.4-A, assertions were soft-deleted via SET a.deletedAt = timestamp
// Phase B3.4-A introduced Canon B tombstone supersession
// This migration converts legacy deletedAt assertions to proper tombstones
//
// Safety:
// - Only creates tombstones for assertions NOT already superseded
// - Preserves deletion timestamp (deletedAt → tombstone.createdAt)
// - Links to same author
// - Removes deletedAt field after migration (cleanup)

// Find all assertions with deletedAt IS NOT NULL that haven't been superseded yet
MATCH (deleted:Assertion)
WHERE deleted.deletedAt IS NOT NULL
  AND NOT EXISTS {
    MATCH (newer:Assertion)
    WHERE newer.supersedesId = deleted.id
  }

// For each legacy deleted assertion, create a tombstone
CREATE (tombstone:Assertion {
  id: 'tomb_legacy_' + deleted.id,
  assertionType: 'tombstone',
  text: '',
  createdAt: deleted.deletedAt,
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

// Expected outcome:
// - Each legacy deleted assertion now has a tombstone superseder
// - No assertions have deletedAt property anymore
// - Feeds will correctly hide these assertions (via tombstone filter)
// - History endpoint shows deletion lineage
