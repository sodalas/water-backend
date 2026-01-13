/**
 * setup_notifications_table.js
 *
 * Phase E.2: Creates the notifications table for derived signal delivery.
 *
 * Usage: node src/scripts/setup_notifications_table.js
 */

import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

async function setupNotificationsTable() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    console.log("🔔 Creating notifications table...");

    // Create notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          recipient_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          assertion_id TEXT NOT NULL,
          notification_type TEXT NOT NULL CHECK (notification_type IN ('reply', 'reaction')),
          reaction_type TEXT CHECK (reaction_type IS NULL OR reaction_type IN ('like', 'acknowledge')),
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          read_at TIMESTAMPTZ
      );
    `);

    // Create unique index for idempotency (handles NULL reaction_type with COALESCE)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency
      ON notifications (actor_id, assertion_id, notification_type, COALESCE(reaction_type, ''));
    `);

    // Index for fetching user's notifications
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
      ON notifications(recipient_id, created_at DESC);
    `);

    // Partial index for unread notifications
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_unread
      ON notifications(recipient_id)
      WHERE NOT read;
    `);

    // Index for cleanup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at
      ON notifications(created_at);
    `);

    console.log("✅ Notifications table created successfully.");
  } catch (err) {
    console.error("❌ Failed to create notifications table:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setupNotificationsTable();
