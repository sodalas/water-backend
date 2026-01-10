-- Migration 004: Add job_runs table
-- Purpose: Track cleanup job execution for temporal drift detection
-- Date: 2026-01-09

CREATE TABLE IF NOT EXISTS job_runs (
    id SERIAL PRIMARY KEY,
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    row_count INTEGER,
    error TEXT,
    CONSTRAINT job_runs_finished_check CHECK (
        (status = 'running' AND finished_at IS NULL) OR
        (status IN ('success', 'failed') AND finished_at IS NOT NULL)
    )
);

-- Index for efficient job status queries
CREATE INDEX idx_job_runs_job_name_started_at ON job_runs(job_name, started_at DESC);

-- Index for health endpoint (last run per job)
CREATE INDEX idx_job_runs_status_finished_at ON job_runs(status, finished_at DESC);

COMMENT ON TABLE job_runs IS 'Tracks execution history of scheduled cleanup jobs';
COMMENT ON COLUMN job_runs.job_name IS 'Unique identifier for the job (e.g., "cleanup_drafts", "cleanup_idempotency")';
COMMENT ON COLUMN job_runs.started_at IS 'Timestamp when job execution began';
COMMENT ON COLUMN job_runs.finished_at IS 'Timestamp when job completed (null if still running)';
COMMENT ON COLUMN job_runs.status IS 'Job execution status: running, success, or failed';
COMMENT ON COLUMN job_runs.row_count IS 'Number of rows processed/deleted (for success status)';
COMMENT ON COLUMN job_runs.error IS 'Error message or stack trace (for failed status)';
