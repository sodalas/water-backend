-- Migration 005: Add status column to publish_idempotency
-- Backend Correctness Sweep: Fix idempotency ordering gap
-- Date: 2026-01-10
--
-- Problem: Idempotency key is recorded AFTER Neo4j write.
-- A crash between Neo4j write and PG insert allows duplicates.
--
-- Solution: Add status column with pending → complete flow
-- INSERT status='pending' BEFORE Neo4j write
-- UPDATE status='complete' + assertion_id AFTER Neo4j write

ALTER TABLE publish_idempotency
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete';

-- Allow assertion_id to be NULL for pending records
ALTER TABLE publish_idempotency
ALTER COLUMN assertion_id DROP NOT NULL;

-- Create partial unique index: only one pending per (idempotency_key, user_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_idempotency_pending_unique
ON publish_idempotency (idempotency_key, user_id)
WHERE status = 'pending';

COMMENT ON COLUMN publish_idempotency.status IS 'Status: pending (before Neo4j write) or complete (after). Prevents duplicate publishes on crash/retry.';

-- Ensure existing records are marked complete
UPDATE publish_idempotency
SET status = 'complete'
WHERE status != 'complete';
