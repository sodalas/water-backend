import pg from 'pg';
import "dotenv/config";

const { Pool } = pg;

// Initialize PostgreSQL pool using environment variables
// Expects DATABASE_URL to be set in .env
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Listener for unexpected errors on idle clients
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});
