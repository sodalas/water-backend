/* eslint-disable no-console */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const USER_ID = "dev-user-1";
const EMAIL = "test@example.com";

async function createDevUser() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    console.log("👤 Ensuring dev user exists...");

    await client.query(
      `
      INSERT INTO "user" (id, email, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (email) DO NOTHING;
      `,
      [USER_ID, EMAIL]
    );

    console.log("✅ Dev user ensured:");
    console.log(`   email: ${EMAIL}`);
  } catch (err) {
    console.error("❌ Failed to ensure dev user:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

createDevUser();