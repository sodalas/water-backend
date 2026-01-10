// src/routes/health.js
import { Router } from "express";
import { getJobHealthSummary } from "../infrastructure/jobs/JobTracking.js";

const router = Router();

/**
 * GET /health/jobs
 * Returns job execution health summary
 *
 * Temporal Invariant C: Gated behind HEALTH_ENDPOINTS_ENABLED environment flag
 * Set HEALTH_ENDPOINTS_ENABLED=true to enable this endpoint
 *
 * Response format:
 * {
 *   jobs: [
 *     {
 *       jobName: "cleanup_drafts",
 *       lastSuccess: "2026-01-09T12:00:00.000Z",
 *       lastRowCount: 5,
 *       consecutiveFailures: 0,
 *       driftHours: 2.5,
 *       status: "healthy" | "drifting" | "failing"
 *     }
 *   ]
 * }
 *
 * Status classification:
 * - healthy: Last success within 48h, no consecutive failures
 * - drifting: Last success > 48h ago
 * - failing: 3+ consecutive failures
 */
router.get("/health/jobs", async (req, res) => {
  // Temporal Invariant C: Gate behind environment flag
  if (process.env.HEALTH_ENDPOINTS_ENABLED !== "true") {
    return res.status(404).json({ error: "Not Found" });
  }
  try {
    const jobSummaries = await getJobHealthSummary();

    const jobsWithStatus = jobSummaries.map(job => {
      let status = "healthy";

      // Classify based on consecutive failures
      if (job.consecutiveFailures >= 3) {
        status = "failing";
      }
      // Classify based on drift (48 hours = 48h)
      else if (job.driftHours !== null && job.driftHours > 48) {
        status = "drifting";
      }
      // No last success means never run successfully
      else if (job.lastSuccess === null) {
        status = "failing";
      }

      return {
        jobName: job.jobName,
        lastSuccess: job.lastSuccess,
        lastRowCount: job.lastRowCount,
        consecutiveFailures: job.consecutiveFailures,
        driftHours: job.driftHours,
        status,
      };
    });

    return res.status(200).json({
      jobs: jobsWithStatus,
    });
  } catch (error) {
    console.error("[HealthJobs] Error fetching job health:", error);
    return res.status(500).json({
      error: "Failed to fetch job health",
    });
  }
});

export default router;
