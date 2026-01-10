// Migration 003: Add uniqueness constraint on supersedesId
// Temporal Invariant B: Prevent double-revision race condition
// Ensures linear revision history (no branching)

// Create unique constraint on supersedesId for non-null values
// This prevents two different assertions from both superseding the same original
// Neo4j syntax: CREATE CONSTRAINT ensures only one assertion can have a given supersedesId
CREATE CONSTRAINT assertion_supersedes_unique IF NOT EXISTS
FOR (a:Assertion)
REQUIRE a.supersedesId IS UNIQUE;

// Note: This constraint only applies to non-null supersedesId values
// Multiple assertions can have supersedesId = null (original assertions)
// But once an assertion is revised (supersedesId != null), that value must be unique
//
// Example enforcement:
// ✅ assertion1.supersedesId = null (allowed)
// ✅ assertion2.supersedesId = null (allowed)
// ✅ assertion3.supersedesId = "asrt_abc" (allowed - first revision of asrt_abc)
// ❌ assertion4.supersedesId = "asrt_abc" (rejected - asrt_abc already revised by assertion3)
