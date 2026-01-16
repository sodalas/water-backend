# Phase F.2 — Graph Schema Hardening (Constraints + Write-Time Guards)

> **Goal:** Move high-impact invariants from “convention/projection” into **schema** (where possible) and **write-time guards** (where schema cannot express the rule).
>
> **No new features. No new semantics.**  
> This phase reduces the chance of *silent graph corruption* under concurrency or manual/migration writes.

---

## Canon Bindings
- `CONTRACTS.md` is authoritative (do not change semantics)
- `DECISIONS.md` (delivery ≠ truth; derived notifications; projections own semantics)
- Phase E Sentry utilities (`logNearMiss`, `captureError`) remain intact

---

## Non-Goals / Refusals
- ❌ No ranking, importance, or ordering changes
- ❌ No new endpoints unless strictly required for migrations/tests
- ❌ No “auto-repair” logic in production flows
- ❌ No broad refactors
- ❌ Do not assume Neo4j Enterprise-only constraints are available unless the repo already uses them

---

## Work Items

### 1) Add Uniqueness Constraints (P0)

#### [NEW] Migration: `00x_add_graph_uniqueness_constraints.cypher`
Add the following constraints:

```cypher
// Assertion.id must be globally unique
CREATE CONSTRAINT assertion_id_unique IF NOT EXISTS
FOR (a:Assertion) REQUIRE a.id IS UNIQUE;

// Identity.id must be globally unique
CREATE CONSTRAINT identity_id_unique IF NOT EXISTS
FOR (i:Identity) REQUIRE i.id IS UNIQUE;

// Topic.id (if Topic is used in this codebase)
CREATE CONSTRAINT topic_id_unique IF NOT EXISTS
FOR (t:Topic) REQUIRE t.id IS UNIQUE;
```

**Guardrail:** If Topic is not present in the model, omit the Topic constraint.

#### [MODIFY] Setup / bootstrap scripts
Ensure the migration is applied in the same way existing Neo4j constraints are applied (follow current convention in your repo: migration folder, setup script, or startup hook).

**Acceptance**
- Constraints appear in `SHOW CONSTRAINTS`
- Tests confirm a duplicate `Assertion.id` or `Identity.id` fails with `ConstraintValidationFailed`

---

### 2) Enforce “No Replies to Tombstoned Assertions” at Write Time (P1)

**Problem:** Deletion creates a tombstone superseder; replies can still be created unless response creation checks “not tombstoned”.

#### [MODIFY] Neo4jGraphAdapter publish response path (response creation)
Within the **same write transaction** that creates the response assertion and RESPONDS_TO edge:

- Verify the target assertion exists
- Verify it has **no tombstone superseder**:

```cypher
MATCH (parent:Assertion {id: $parentId})
WHERE NOT EXISTS {
  MATCH (t:Assertion)
  WHERE t.supersedesId = parent.id AND t.assertionType = 'tombstone'
}
RETURN parent
```

If this check fails, throw a typed domain error mapped to **409 Conflict** (or 410 Gone if you have that contract; otherwise 409).

**Sentry:** `logNearMiss("reply-to-tombstoned", {...})` (warning), but do not throw a raw Error without mapping.

**Acceptance**
- Concurrent scenario “reply while deletion in-flight” results in deterministic failure (no silent creation)
- validate-graph-integrity shows zero responses that target tombstoned assertions

---

### 3) Normalize Identity Creation Across Write Paths (P1)

**Problem:** different MERGE patterns create “thin” Identity nodes depending on which path wins.

#### [NEW] Shared helper: `ensureIdentity(tx, user)`
A single function used by:
- publish path
- reaction path
- any future graph writes

Required behavior:
- `MERGE (i:Identity {id: $id})`
- Set stable profile properties on both create and match (only if values are available; never overwrite with null/undefined)

Example shape (conceptual):
```cypher
MERGE (i:Identity {id: $id})
SET i.handle = coalesce($handle, i.handle),
    i.displayName = coalesce($displayName, i.displayName)
RETURN i
```

**Guardrail:** Do not rely on `ON CREATE` only; use coalesce-set to avoid “thin identity” persistence.

**Acceptance**
- Running reactions before publish does not permanently lock Identity into missing handle/displayName (when those values are available to later writes)
- Identity writes remain idempotent

---

## Tests (Required)

### T1) Constraint Existence + Violation Tests (P0)
Add an integration test that:
- creates an Assertion with id X
- attempts to create another Assertion with id X
- asserts Neo4j raises constraint error

Repeat for Identity.id.

### T2) Reply-to-Tombstone Race Test (P1)
Integration test scenario:
1) Create root assertion A
2) Tombstone A (create tombstone superseder)
3) Attempt to create response with RESPONDS_TO → A
Expected:
- write fails deterministically (Conflict/Gone)
- no response node exists
- optional: near-miss warning recorded (do not require Sentry in tests unless already harnessed)

### T3) Identity Merge Consistency (P1)
Test:
- create Identity via reaction path with minimal props
- then publish path sets handle/displayName
- assert Identity has handle/displayName after second operation (if provided)

---

## Acceptance Criteria
- [x] `Assertion.id` uniqueness enforced by schema constraint (`migrations/005_add_id_uniqueness_constraints_neo4j.cypher`)
- [x] `Identity.id` uniqueness enforced by schema constraint (`migrations/005_add_id_uniqueness_constraints_neo4j.cypher`)
- [x] Replies cannot be created to tombstoned assertions (write-time guard in `Neo4jGraphAdapter.publish`)
- [x] Identity MERGE patterns unified via `ensureIdentity` helper
- [x] New tests created (`schemaConstraints.test.js`, `schemaGuards.test.js`) - require Neo4j for execution
- [x] No API payload shapes changed
- [x] No ranking/importance semantics introduced

## Implementation Summary

### Files Modified
- `src/infrastructure/graph/Neo4jGraphAdapter.js`
  - Added `ReplyToTombstonedError` class for tombstone guard
  - Added tombstone check in publish path for responses
  - Updated publish to use `ensureIdentity` helper
- `src/services/PublishService.js`
  - Added `ReplyToTombstonedError` → `GoneError` (410) mapping
- `src/domain/errors/AppError.js`
  - Added `GoneError` class (410 status)

### Files Created
- `src/infrastructure/graph/__tests__/schemaConstraints.test.js` (T1: Constraint tests)
- `src/infrastructure/graph/__tests__/schemaGuards.test.js` (T2: Tombstone guard, T3: Identity merge)

---

_End of Phase F.2_
