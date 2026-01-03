/* eslint-disable no-console */
import pg from "pg";

const { Pool } = pg;

async function setup() {
  const pool = new Pool({
    connectionString:
      "postgresql://water_dev:water_dev_password@localhost:5432/water_db",
  });

  const client = await pool.connect();

  try {
    console.log("🚰 Setting up Water database schema...");

    // --- Users (Better Auth expects this) ---
    // --- Reset ---
    await client.query(`DROP TABLE IF EXISTS "verification"`);
    await client.query(`DROP TABLE IF EXISTS "account"`);
    await client.query(`DROP TABLE IF EXISTS "session"`);
    await client.query(`DROP TABLE IF EXISTS "user" CASCADE`); // CASCADE might be needed if referenced by others not listed
    await client.query(`DROP TABLE IF EXISTS "composer_drafts"`);

    // --- User ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "email" TEXT UNIQUE NOT NULL,
        "emailVerified" BOOLEAN NOT NULL,
        "image" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);

    // --- Session ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id" TEXT PRIMARY KEY,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "token" TEXT UNIQUE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
      );
    `);

    // --- Account ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "account" (
        "id" TEXT PRIMARY KEY,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "idToken" TEXT,
        "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "scope" TEXT,
        "password" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);

    // --- Verification ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "verification" (
        "id" TEXT PRIMARY KEY,
        "identifier" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE,
        "updatedAt" TIMESTAMP WITH TIME ZONE
      );
    `);

    // --- Composer Drafts (Canonical Schema) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS composer_drafts (
        user_id text primary key,
        schema_version int not null default 1,
        client_id text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now(),
        created_at timestamptz not null default now()
      );
    `);

    // Optional: index for pruning / lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS composer_drafts_updated_at_idx
      ON composer_drafts (updated_at);
    `);

    console.log("✅ Database schema ready.");
  } catch (err) {
    console.error("❌ Failed to set up database:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
