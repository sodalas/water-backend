/**
 * deviceTokens.js
 *
 * Phase E.4: Device Token Registration for Push Notifications
 *
 * INFRASTRUCTURE ONLY - no notification semantics.
 * Device tokens are transport artifacts, not domain state.
 */

import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * POST /api/device-tokens
 * Register or update a device token for push notifications.
 *
 * Body: { token: string, platform: "ios" | "android" | "web" }
 *
 * Idempotent: Same token updates existing record.
 */
router.post("/device-tokens", async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { token, platform } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Token is required" });
  }

  if (!["ios", "android", "web"].includes(platform)) {
    return res.status(400).json({ error: "Platform must be ios, android, or web" });
  }

  try {
    // Upsert: update user_id if token exists, otherwise insert
    await pool.query(`
      INSERT INTO device_tokens (user_id, token, platform, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (token) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        updated_at = NOW()
    `, [req.user.id, token, platform]);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[DeviceTokens] Registration failed:", error.message);
    res.status(500).json({ error: "Failed to register token" });
  }
});

/**
 * DELETE /api/device-tokens
 * Unregister a device token.
 *
 * Body: { token: string }
 */
router.delete("/device-tokens", async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    await pool.query(
      "DELETE FROM device_tokens WHERE user_id = $1 AND token = $2",
      [req.user.id, token]
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[DeviceTokens] Deletion failed:", error.message);
    res.status(500).json({ error: "Failed to delete token" });
  }
});

export default router;
