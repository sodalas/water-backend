-- Migration 001: Add role field to users table
-- Phase B1: Revision Canon B Foundations + Role Model

-- Add role column to user table (better-auth creates this table)
-- Default role is 'user' for all existing and new users
ALTER TABLE IF EXISTS "user"
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Add constraint to ensure only valid roles
ALTER TABLE IF EXISTS "user"
ADD CONSTRAINT check_user_role
CHECK (role IN ('user', 'admin', 'super_admin'));

-- Create index for role-based queries
CREATE INDEX IF NOT EXISTS idx_user_role ON "user"(role);

-- Migrate existing users to 'user' role (idempotent)
UPDATE "user"
SET role = 'user'
WHERE role IS NULL OR role = '';

COMMENT ON COLUMN "user".role IS 'User role: user | admin | super_admin. Default: user';
