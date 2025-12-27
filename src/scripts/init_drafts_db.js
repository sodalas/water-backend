import { pool } from '../db.js';
import "dotenv/config";

async function initDB() {
  console.log('Initializing composer_drafts table...');
  try {
    await pool.query(`
      create table if not exists composer_drafts (
        user_id text primary key,
        schema_version int not null,
        updated_at timestamptz not null default now(),
        client_id text not null,
        payload jsonb not null
      );
    `);
    console.log('Success: composer_drafts table ready.');
  } catch (err) {
    console.error('Error initializing DB:', err);
  } finally {
    await pool.end();
  }
}

initDB();
