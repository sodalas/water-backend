// Migration 002: Add revision linkage fields to Assertion nodes
// Phase B1: Revision Canon B Foundations

// Add supersedesId property to existing Assertion nodes (nullable)
// This field links to the prior assertion that this one revises
MATCH (a:Assertion)
WHERE NOT EXISTS(a.supersedesId)
SET a.supersedesId = null;

// Add revisionNumber property (nullable, starts at 1 for revised assertions)
MATCH (a:Assertion)
WHERE NOT EXISTS(a.revisionNumber)
SET a.revisionNumber = null;

// Add rootAssertionId property (nullable, points to original assertion in chain)
MATCH (a:Assertion)
WHERE NOT EXISTS(a.rootAssertionId)
SET a.rootAssertionId = null;

// Create index on supersedesId for efficient supersession checks
CREATE INDEX assertion_supersedes_id IF NOT EXISTS
FOR (a:Assertion)
ON (a.supersedesId);

// Create index on rootAssertionId for efficient chain queries
CREATE INDEX assertion_root_id IF NOT EXISTS
FOR (a:Assertion)
ON (a.rootAssertionId);

// Note: These fields remain null for non-revised assertions
// When an assertion is created as a revision:
//   - supersedesId = id of the assertion being revised
//   - revisionNumber = previous revisionNumber + 1 (or 1 if original was null)
//   - rootAssertionId = rootAssertionId of previous (or previous.id if it was original)
