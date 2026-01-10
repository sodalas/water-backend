import { pool } from '../../db.js';

/**
 * Start tracking a job run
 * @param {string} jobName - Unique job identifier
 * @returns {Promise<number>} Job run ID
 */
export async function startJobRun(jobName) {
  const result = await pool.query(
    `
    INSERT INTO job_runs (job_name, started_at, status)
    VALUES ($1, NOW(), 'running')
    RETURNING id
    `,
    [jobName]
  );
  return result.rows[0].id;
}

/**
 * Mark job run as successful
 * @param {number} jobRunId - Job run ID from startJobRun
 * @param {number} rowCount - Number of rows processed
 * @returns {Promise<void>}
 */
export async function completeJobRun(jobRunId, rowCount) {
  await pool.query(
    `
    UPDATE job_runs
    SET finished_at = NOW(),
        status = 'success',
        row_count = $2
    WHERE id = $1
    `,
    [jobRunId, rowCount]
  );
}

/**
 * Mark job run as failed
 * @param {number} jobRunId - Job run ID from startJobRun
 * @param {Error} error - Error object
 * @returns {Promise<void>}
 */
export async function failJobRun(jobRunId, error) {
  await pool.query(
    `
    UPDATE job_runs
    SET finished_at = NOW(),
        status = 'failed',
        error = $2
    WHERE id = $1
    `,
    [jobRunId, error.message || String(error)]
  );
}

/**
 * Get last successful run for a job
 * @param {string} jobName - Job identifier
 * @returns {Promise<{ finishedAt: Date, rowCount: number } | null>}
 */
export async function getLastSuccessfulRun(jobName) {
  const result = await pool.query(
    `
    SELECT finished_at, row_count
    FROM job_runs
    WHERE job_name = $1 AND status = 'success'
    ORDER BY finished_at DESC
    LIMIT 1
    `,
    [jobName]
  );

  if (result.rowCount === 0) return null;

  return {
    finishedAt: result.rows[0].finished_at,
    rowCount: result.rows[0].row_count,
  };
}

/**
 * Get consecutive failure count for a job
 * @param {string} jobName - Job identifier
 * @returns {Promise<number>} Number of consecutive failures since last success
 */
export async function getConsecutiveFailures(jobName) {
  const result = await pool.query(
    `
    WITH recent_runs AS (
      SELECT status, finished_at
      FROM job_runs
      WHERE job_name = $1 AND status IN ('success', 'failed')
      ORDER BY finished_at DESC
    )
    SELECT COUNT(*) as failure_count
    FROM recent_runs
    WHERE status = 'failed'
      AND finished_at > COALESCE(
        (SELECT finished_at FROM recent_runs WHERE status = 'success' LIMIT 1),
        '1970-01-01'::timestamptz
      )
    `,
    [jobName]
  );

  return parseInt(result.rows[0].failure_count, 10);
}

/**
 * Get health summary for all jobs
 * @returns {Promise<Array<{ jobName: string, lastSuccess: Date | null, consecutiveFailures: number, driftHours: number | null }>>}
 */
export async function getJobHealthSummary() {
  const result = await pool.query(
    `
    WITH last_success AS (
      SELECT DISTINCT ON (job_name)
        job_name,
        finished_at as last_success_at,
        row_count
      FROM job_runs
      WHERE status = 'success'
      ORDER BY job_name, finished_at DESC
    ),
    consecutive_failures AS (
      SELECT
        job_name,
        COUNT(*) as failure_count
      FROM job_runs jr
      WHERE status = 'failed'
        AND finished_at > COALESCE(
          (SELECT finished_at FROM job_runs WHERE job_name = jr.job_name AND status = 'success' ORDER BY finished_at DESC LIMIT 1),
          '1970-01-01'::timestamptz
        )
      GROUP BY job_name
    )
    SELECT
      COALESCE(ls.job_name, cf.job_name) as job_name,
      ls.last_success_at,
      ls.row_count as last_row_count,
      COALESCE(cf.failure_count, 0) as consecutive_failures,
      CASE
        WHEN ls.last_success_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (NOW() - ls.last_success_at)) / 3600
        ELSE NULL
      END as drift_hours
    FROM last_success ls
    FULL OUTER JOIN consecutive_failures cf ON ls.job_name = cf.job_name
    ORDER BY job_name
    `
  );

  return result.rows.map(row => ({
    jobName: row.job_name,
    lastSuccess: row.last_success_at,
    lastRowCount: row.last_row_count,
    consecutiveFailures: parseInt(row.consecutive_failures, 10),
    driftHours: row.drift_hours ? parseFloat(row.drift_hours) : null,
  }));
}
