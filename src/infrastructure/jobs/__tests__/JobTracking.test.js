// src/infrastructure/jobs/__tests__/JobTracking.test.js
// Temporal Invariant C: Observable cleanup job tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startJobRun,
  completeJobRun,
  failJobRun,
  getLastSuccessfulRun,
  getConsecutiveFailures,
  getJobHealthSummary,
} from "../JobTracking.js";
import { pool } from "../../../db.js";

describe("Temporal Invariant C: Observable Cleanup Jobs", () => {
  const testJobName = "test_job_cleanup";

  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM job_runs WHERE job_name = $1", [testJobName]);
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM job_runs WHERE job_name = $1", [testJobName]);
  });

  describe("startJobRun", () => {
    it("should create a running job record", async () => {
      const jobRunId = await startJobRun(testJobName);

      expect(jobRunId).toBeGreaterThan(0);

      const result = await pool.query(
        "SELECT * FROM job_runs WHERE id = $1",
        [jobRunId]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].job_name).toBe(testJobName);
      expect(result.rows[0].status).toBe("running");
      expect(result.rows[0].finished_at).toBeNull();
    });
  });

  describe("completeJobRun", () => {
    it("should mark job as successful with row count", async () => {
      const jobRunId = await startJobRun(testJobName);
      await completeJobRun(jobRunId, 42);

      const result = await pool.query(
        "SELECT * FROM job_runs WHERE id = $1",
        [jobRunId]
      );

      expect(result.rows[0].status).toBe("success");
      expect(result.rows[0].row_count).toBe(42);
      expect(result.rows[0].finished_at).not.toBeNull();
    });
  });

  describe("failJobRun", () => {
    it("should mark job as failed with error message", async () => {
      const jobRunId = await startJobRun(testJobName);
      const error = new Error("Test error message");
      await failJobRun(jobRunId, error);

      const result = await pool.query(
        "SELECT * FROM job_runs WHERE id = $1",
        [jobRunId]
      );

      expect(result.rows[0].status).toBe("failed");
      expect(result.rows[0].error).toBe("Test error message");
      expect(result.rows[0].finished_at).not.toBeNull();
    });
  });

  describe("getLastSuccessfulRun", () => {
    it("should return null for job with no successful runs", async () => {
      const result = await getLastSuccessfulRun(testJobName);
      expect(result).toBeNull();
    });

    it("should return most recent successful run", async () => {
      // Create two successful runs
      const jobRunId1 = await startJobRun(testJobName);
      await completeJobRun(jobRunId1, 10);

      // Wait 100ms to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100));

      const jobRunId2 = await startJobRun(testJobName);
      await completeJobRun(jobRunId2, 20);

      const result = await getLastSuccessfulRun(testJobName);

      expect(result).not.toBeNull();
      expect(result.rowCount).toBe(20); // Should be the most recent
      expect(result.finishedAt).toBeInstanceOf(Date);
    });

    it("should ignore failed runs", async () => {
      const jobRunId1 = await startJobRun(testJobName);
      await completeJobRun(jobRunId1, 15);

      const jobRunId2 = await startJobRun(testJobName);
      await failJobRun(jobRunId2, new Error("Test failure"));

      const result = await getLastSuccessfulRun(testJobName);

      expect(result).not.toBeNull();
      expect(result.rowCount).toBe(15); // Should return the success, not the failure
    });
  });

  describe("getConsecutiveFailures", () => {
    it("should return 0 for job with no failures", async () => {
      const count = await getConsecutiveFailures(testJobName);
      expect(count).toBe(0);
    });

    it("should count failures since last success", async () => {
      // Success
      const jobRunId1 = await startJobRun(testJobName);
      await completeJobRun(jobRunId1, 5);

      // Wait to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100));

      // Two failures
      const jobRunId2 = await startJobRun(testJobName);
      await failJobRun(jobRunId2, new Error("Failure 1"));

      await new Promise(resolve => setTimeout(resolve, 100));

      const jobRunId3 = await startJobRun(testJobName);
      await failJobRun(jobRunId3, new Error("Failure 2"));

      const count = await getConsecutiveFailures(testJobName);
      expect(count).toBe(2);
    });

    it("should reset count after a success", async () => {
      // Two failures
      const jobRunId1 = await startJobRun(testJobName);
      await failJobRun(jobRunId1, new Error("Failure 1"));

      await new Promise(resolve => setTimeout(resolve, 100));

      const jobRunId2 = await startJobRun(testJobName);
      await failJobRun(jobRunId2, new Error("Failure 2"));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Success (resets counter)
      const jobRunId3 = await startJobRun(testJobName);
      await completeJobRun(jobRunId3, 10);

      const count = await getConsecutiveFailures(testJobName);
      expect(count).toBe(0);
    });
  });

  describe("getJobHealthSummary", () => {
    it("should return empty array when no jobs have run", async () => {
      const summary = await getJobHealthSummary();
      // Filter to only our test job (other jobs may exist)
      const testJobSummary = summary.filter(j => j.jobName === testJobName);
      expect(testJobSummary).toEqual([]);
    });

    it("should return summary for successful job", async () => {
      const jobRunId = await startJobRun(testJobName);
      await completeJobRun(jobRunId, 25);

      const summary = await getJobHealthSummary();
      const testJobSummary = summary.find(j => j.jobName === testJobName);

      expect(testJobSummary).toBeDefined();
      expect(testJobSummary.jobName).toBe(testJobName);
      expect(testJobSummary.lastSuccess).toBeInstanceOf(Date);
      expect(testJobSummary.lastRowCount).toBe(25);
      expect(testJobSummary.consecutiveFailures).toBe(0);
      expect(testJobSummary.driftHours).toBeLessThan(1); // Just ran
    });

    it("should calculate drift hours correctly", async () => {
      // Insert a job run from 3 hours ago
      await pool.query(
        `INSERT INTO job_runs (job_name, started_at, finished_at, status, row_count)
         VALUES ($1, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours', 'success', 10)`,
        [testJobName]
      );

      const summary = await getJobHealthSummary();
      const testJobSummary = summary.find(j => j.jobName === testJobName);

      expect(testJobSummary).toBeDefined();
      expect(testJobSummary.driftHours).toBeGreaterThan(2.9);
      expect(testJobSummary.driftHours).toBeLessThan(3.1);
    });

    it("should track consecutive failures", async () => {
      // Success
      const jobRunId1 = await startJobRun(testJobName);
      await completeJobRun(jobRunId1, 5);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Three failures
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const jobRunId = await startJobRun(testJobName);
        await failJobRun(jobRunId, new Error(`Failure ${i + 1}`));
      }

      const summary = await getJobHealthSummary();
      const testJobSummary = summary.find(j => j.jobName === testJobName);

      expect(testJobSummary).toBeDefined();
      expect(testJobSummary.consecutiveFailures).toBe(3);
    });
  });
});
