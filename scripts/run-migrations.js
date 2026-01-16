#!/usr/bin/env node
/**
 * Simple migration runner for PostgreSQL
 * Runs all .sql files in the migrations directory in alphabetical order
 */
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const { Pool } = pg;

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Get all .sql files sorted alphabetically
    const files = await readdir(migrationsDir);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${sqlFiles.length} migration files`);

    for (const file of sqlFiles) {
      const filePath = join(migrationsDir, file);
      const sql = await readFile(filePath, 'utf-8');

      console.log(`Running migration: ${file}`);
      try {
        await pool.query(sql);
        console.log(`  ✓ ${file} completed`);
      } catch (err) {
        // Some errors are expected (e.g., "already exists")
        if (err.code === '42P07' || err.code === '42710') {
          console.log(`  ✓ ${file} skipped (already applied)`);
        } else {
          console.error(`  ✗ ${file} failed:`, err.message);
          throw err;
        }
      }
    }

    console.log('\nAll migrations completed successfully');
  } finally {
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
