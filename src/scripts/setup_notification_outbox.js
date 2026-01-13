/**
 * setup_notification_outbox.js
 *
 * Phase E.3: Creates the notification outbox table for delivery artifacts.
 *
 * The outbox ensures:
 * - At-least-once delivery semantics
 * - Retry with backoff
 * - Observable delivery status
 *
 * Usage: node src/scripts/setup_notification_outbox.js
 */

import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

async function setupNotificationOutbox() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    console.log("📤 Creating notification_outbox table...");

    // Create notification_outbox table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_outbox (
          id TEXT PRIMARY KEY,
          notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
          adapter TEXT NOT NULL CHECK (adapter IN ('websocket', 'push')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
          last_error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          delivered_at TIMESTAMPTZ
      );
    `);

    // Index for fetching pending deliveries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_pending
      ON notification_outbox(adapter, status, next_attempt_at)
      WHERE status = 'pending';
    `);

    // Index for notification lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_notification
      ON notification_outbox(notification_id);
    `);

    // Index for cleanup (old delivered/failed entries)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_created
      ON notification_outbox(created_at);
    `);

    // Unique constraint: one outbox entry per notification per adapter
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_unique_delivery
      ON notification_outbox(notification_id, adapter);
    `);

    console.log("✅ Notification outbox table created successfully.");
  } catch (err) {
    console.error("❌ Failed to create notification outbox table:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setupNotificationOutbox();
