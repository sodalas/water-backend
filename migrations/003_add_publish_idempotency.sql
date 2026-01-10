-- Migration 003: Add publish_idempotency table
-- Purpose: Enable idempotent publish requests to prevent double-submission
-- Date: 2026-01-09

CREATE TABLE IF NOT EXISTS publish_idempotency (
    idempotency_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    assertion_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    PRIMARY KEY (idempotency_key, user_id)
);

-- Index for efficient cleanup of expired records
CREATE INDEX idx_publish_idempotency_expires_at ON publish_idempotency(expires_at);

-- Index for user-specific lookups
CREATE INDEX idx_publish_idempotency_user_id ON publish_idempotency(user_id);

-- Index for assertion lookups (for debugging/audit)
CREATE INDEX idx_publish_idempotency_assertion_id ON publish_idempotency(assertion_id);

COMMENT ON TABLE publish_idempotency IS 'Tracks idempotency keys for publish requests to prevent duplicate submissions';
COMMENT ON COLUMN publish_idempotency.idempotency_key IS 'Client-provided unique key for deduplication (e.g., UUID)';
COMMENT ON COLUMN publish_idempotency.user_id IS 'User who made the publish request';
COMMENT ON COLUMN publish_idempotency.assertion_id IS 'ID of the assertion created by this publish request';
COMMENT ON COLUMN publish_idempotency.expires_at IS 'Expiration timestamp (24h default) for cleanup job';
