// Migration 005: Add uniqueness constraints for primary node IDs
// Phase F.2 Graph Schema Hardening
//
// Purpose: Enforce uniqueness at schema level to prevent silent graph corruption
// under concurrency or manual/migration writes.
//
// These constraints ensure:
// - No two Assertion nodes can have the same id
// - No two Identity nodes can have the same id
// - No two Topic nodes can have the same id
//
// Note: These are READ + WRITE constraints - they prevent duplicate creation
// and allow indexed lookups.

// Assertion.id must be globally unique
CREATE CONSTRAINT assertion_id_unique IF NOT EXISTS
FOR (a:Assertion)
REQUIRE a.id IS UNIQUE;

// Identity.id must be globally unique
CREATE CONSTRAINT identity_id_unique IF NOT EXISTS
FOR (i:Identity)
REQUIRE i.id IS UNIQUE;

// Topic.id must be globally unique
CREATE CONSTRAINT topic_id_unique IF NOT EXISTS
FOR (t:Topic)
REQUIRE t.id IS UNIQUE;

// Verification:
// After applying this migration, run:
//   SHOW CONSTRAINTS
// Expected output should include:
//   assertion_id_unique
//   identity_id_unique
//   topic_id_unique
//
// Test violation by attempting:
//   CREATE (a:Assertion {id: 'test-dup'})
//   CREATE (b:Assertion {id: 'test-dup'})
// Expected: ConstraintValidationFailed error on second CREATE
