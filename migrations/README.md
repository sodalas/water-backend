# Water Backend Migrations - Phase B1

## Overview
Phase B1 introduces Revision Canon B foundations and a role-based permission model. These migrations add the necessary schema changes to support versioned revisions.

## Migration Order

### 1. PostgreSQL: Add User Roles
**File:** `001_add_user_roles.sql`

**Purpose:** Add `role` field to the `user` table managed by better-auth.

**How to apply:**
```bash
psql $DATABASE_URL -f migrations/001_add_user_roles.sql
```

**What it does:**
- Adds `role` column with default `'user'`
- Adds check constraint for valid roles: `user`, `admin`, `super_admin`
- Creates index on role for efficient queries
- Migrates existing users to `'user'` role

**Verification:**
```sql
SELECT id, email, role FROM "user" LIMIT 5;
```

All users should have `role = 'user'`.

### 2. Neo4j: Add Revision Fields
**File:** `002_add_revision_fields_neo4j.cypher`

**Purpose:** Add revision linkage fields to Assertion nodes.

**How to apply:**
```bash
# Using Neo4j Browser:
# 1. Open Neo4j Browser at http://localhost:7474
# 2. Copy and paste the contents of 002_add_revision_fields_neo4j.cypher
# 3. Execute each statement

# OR using cypher-shell:
cypher-shell -u neo4j -p your-password -f migrations/002_add_revision_fields_neo4j.cypher
```

**What it does:**
- Adds `supersedesId` field (nullable) - links to superseded assertion
- Adds `revisionNumber` field (nullable) - tracks revision count
- Adds `rootAssertionId` field (nullable) - links to original assertion in chain
- Creates indexes on `supersedesId` and `rootAssertionId`

**Verification:**
```cypher
MATCH (a:Assertion)
RETURN a.id, a.supersedesId, a.revisionNumber, a.rootAssertionId
LIMIT 5;
```

All existing assertions should have these fields set to `null`.

## Rollback Instructions

### Rollback 001 (PostgreSQL)
```sql
-- Remove role column
ALTER TABLE "user" DROP COLUMN IF EXISTS role;

-- Drop index
DROP INDEX IF EXISTS idx_user_role;
```

### Rollback 002 (Neo4j)
```cypher
// Remove revision fields
MATCH (a:Assertion)
REMOVE a.supersedesId, a.revisionNumber, a.rootAssertionId;

// Drop indexes
DROP INDEX assertion_supersedes_id IF EXISTS;
DROP INDEX assertion_root_id IF EXISTS;
```

## Post-Migration Verification

### 1. Check User Roles
```sql
-- Count users by role
SELECT role, COUNT(*)
FROM "user"
GROUP BY role;
```

Expected: All users should have `role = 'user'`.

### 2. Check Assertion Fields
```cypher
// Check that revision fields exist
MATCH (a:Assertion)
RETURN count(a) as total,
       count(a.supersedesId) as withSupersedes,
       count(a.revisionNumber) as withRevisionNum,
       count(a.rootAssertionId) as withRootId;
```

Expected: `total` = number of assertions, others should be 0 (null values don't count).

### 3. Test Permission Logic
Run the test suite:
```bash
npm test src/routes/__tests__/publish.revision.test.js
```

## Notes

- **Idempotent:** Both migrations use `IF NOT EXISTS` / `IF EXISTS` checks and can be run multiple times safely.
- **Additive Only:** These migrations only add fields, they don't modify or remove existing data.
- **No Downtime:** Migrations can be applied to a running system (fields are nullable).
- **No UI Changes:** Phase B1 is backend-only; no frontend changes required.

## Future Phases

- **Phase B2:** Update feed queries to hide superseded assertions
- **Phase B3:** Add revision history viewing for authors/admins
- **Phase B4:** Add admin dashboard for role management
