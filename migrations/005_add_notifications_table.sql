-- Migration 005: Add notifications table
-- Phase E.2: Notifications (Canon-Guarded, Derived, Push-Ready)
--
-- Notifications are DELIVERY ARTIFACTS, not authoritative data.
-- They can be deleted at any time without affecting system correctness.

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    assertion_id TEXT NOT NULL,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('reply', 'reaction')),
    reaction_type TEXT CHECK (reaction_type IS NULL OR reaction_type IN ('like', 'acknowledge')),
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ,

    -- Cross-check constraint between notification_type and reaction_type
    CONSTRAINT notifications_reaction_type_check CHECK (
        (notification_type = 'reaction' AND reaction_type IS NOT NULL) OR
        (notification_type != 'reaction' AND reaction_type IS NULL)
    )
);

-- Idempotency constraint: one notification per actor/assertion/type/reactionType
-- Prevents duplicate notifications for the same event
-- Uses unique index with COALESCE since table constraints don't support expressions
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency
ON notifications(actor_id, assertion_id, notification_type, COALESCE(reaction_type, ''));

-- Index for fetching user's notifications (newest first)
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
ON notifications(recipient_id, created_at DESC);

-- Partial index for unread notifications (for badge counts)
CREATE INDEX IF NOT EXISTS idx_notifications_unread
ON notifications(recipient_id)
WHERE NOT read;

-- Index for cleanup of old notifications (if needed)
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
ON notifications(created_at);
