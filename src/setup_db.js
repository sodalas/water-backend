import "dotenv/config";
import { pool } from "./db.js";

async function run() {
  console.log("Setting up database...");
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS composer_drafts (
        user_id TEXT PRIMARY KEY,
        client_id TEXT,
        schema_version INTEGER DEFAULT 1,
        payload JSONB,
        updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("Table 'composer_drafts' ensured.");
  } catch (err) {
    console.error("Setup Error:", err);
  } finally {
    await pool.end();
  }
}

run();
