/**
 * create_articles_table.js
 *
 * Creates the articles table for published articles.
 *
 * Storage Contract (🟥 CANONICAL):
 * - id: Unique article identifier
 * - title: Article title
 * - dek: Optional subtitle/description
 * - rawMarkdown: Original Markdown (for revisions only)
 * - renderedHtml: Server-rendered HTML (ONLY field used by readers)
 * - readingTimeMinutes: Server-computed reading time
 * - publishedAt: Publication timestamp
 * - authorId: Foreign key to user table
 * - originArticleId: Optional, for tracking revisions
 *
 * Invariants:
 * - renderedHtml is the only field used by readers
 * - rawMarkdown exists only for revisions
 * - Revisions create new articles, never mutations
 */

import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

async function createArticlesTable() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    console.log("📚 Creating articles table...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        dek TEXT,
        raw_markdown TEXT NOT NULL,
        rendered_html TEXT NOT NULL,
        reading_time_minutes INTEGER NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        author_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        origin_article_id TEXT REFERENCES articles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Index for fetching by author
    await client.query(`
      CREATE INDEX IF NOT EXISTS articles_author_id_idx
      ON articles (author_id, published_at DESC);
    `);

    // Index for fetching by publish date
    await client.query(`
      CREATE INDEX IF NOT EXISTS articles_published_at_idx
      ON articles (published_at DESC);
    `);

    // Index for tracking revisions
    await client.query(`
      CREATE INDEX IF NOT EXISTS articles_origin_id_idx
      ON articles (origin_article_id);
    `);

    console.log("✅ Articles table created successfully.");
  } catch (err) {
    console.error("❌ Failed to create articles table:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

createArticlesTable();
