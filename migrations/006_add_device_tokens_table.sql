-- Migration 006: Add device tokens table for FCM push delivery
-- Phase E.4: Push Adapter Device Registration
--
-- Device tokens are INFRASTRUCTURE ONLY, not authoritative data.
-- They can be deleted at any time without affecting system correctness.

CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One token per device (token is unique globally)
    CONSTRAINT device_tokens_token_unique UNIQUE (token)
);

-- Index for looking up user's tokens (primary use case)
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id
ON device_tokens(user_id);

-- Index for token cleanup (when FCM reports invalid)
CREATE INDEX IF NOT EXISTS idx_device_tokens_token
ON device_tokens(token);
