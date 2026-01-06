/**
 * ArticlePersistence.js
 *
 * CANONICAL ARTICLE PERSISTENCE LAYER (🟥 IMMUTABLE)
 *
 * Handles all database operations for published articles.
 *
 * Invariants:
 * - Articles are immutable once published
 * - Revisions create new articles (never mutations)
 * - renderedHtml is the only field served to readers
 * - All operations use server-rendered HTML
 */

import { pool } from "../../db.js";
import { randomBytes } from "crypto";

/**
 * Generates a unique article ID
 */
function generateArticleId() {
  return `art_${randomBytes(16).toString("hex")}`;
}

/**
 * Creates a new article in the database
 *
 * @param {Object} article - Article data
 * @param {string} article.title - Article title
 * @param {string} article.dek - Optional subtitle
 * @param {string} article.rawMarkdown - Original Markdown
 * @param {string} article.renderedHtml - Server-rendered HTML
 * @param {number} article.readingTimeMinutes - Reading time
 * @param {string} article.authorId - Author user ID
 * @param {string} [article.originArticleId] - Optional origin article for revisions
 * @returns {Promise<Object>} Created article with ID
 */
export async function createArticle({
  title,
  dek,
  rawMarkdown,
  renderedHtml,
  readingTimeMinutes,
  authorId,
  originArticleId = null,
}) {
  const id = generateArticleId();

  const result = await pool.query(
    `
    INSERT INTO articles (
      id, title, dek, raw_markdown, rendered_html,
      reading_time_minutes, author_id, origin_article_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, title, dek, reading_time_minutes, published_at, author_id
    `,
    [
      id,
      title,
      dek || null,
      rawMarkdown,
      renderedHtml,
      readingTimeMinutes,
      authorId,
      originArticleId,
    ]
  );

  return result.rows[0];
}

/**
 * Fetches an article by ID (PUBLIC - no auth required)
 *
 * Returns ONLY the fields needed for reading:
 * - id, title, dek, rendered_html, reading_time_minutes, published_at
 * - author name and id
 *
 * Does NOT return rawMarkdown (server-only)
 *
 * @param {string} articleId - Article ID
 * @returns {Promise<Object|null>} Article data or null if not found
 */
export async function getArticleById(articleId) {
  const result = await pool.query(
    `
    SELECT
      a.id,
      a.title,
      a.dek,
      a.rendered_html,
      a.reading_time_minutes,
      a.published_at,
      u.id as author_id,
      u.name as author_name
    FROM articles a
    JOIN "user" u ON a.author_id = u.id
    WHERE a.id = $1
    `,
    [articleId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    title: row.title,
    dek: row.dek,
    html: row.rendered_html,
    readingTimeMinutes: row.reading_time_minutes,
    publishedAt: row.published_at,
    author: {
      id: row.author_id,
      name: row.author_name,
    },
  };
}

/**
 * Fetches articles by author
 *
 * @param {string} authorId - Author user ID
 * @param {number} limit - Max articles to return
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of articles
 */
export async function getArticlesByAuthor(authorId, limit = 20, offset = 0) {
  const result = await pool.query(
    `
    SELECT
      a.id,
      a.title,
      a.dek,
      a.reading_time_minutes,
      a.published_at,
      u.id as author_id,
      u.name as author_name
    FROM articles a
    JOIN "user" u ON a.author_id = u.id
    WHERE a.author_id = $1
    ORDER BY a.published_at DESC
    LIMIT $2 OFFSET $3
    `,
    [authorId, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    dek: row.dek,
    readingTimeMinutes: row.reading_time_minutes,
    publishedAt: row.published_at,
    author: {
      id: row.author_id,
      name: row.author_name,
    },
  }));
}

/**
 * Fetches recent articles (public feed)
 *
 * @param {number} limit - Max articles to return
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of articles
 */
export async function getRecentArticles(limit = 20, offset = 0) {
  const result = await pool.query(
    `
    SELECT
      a.id,
      a.title,
      a.dek,
      a.reading_time_minutes,
      a.published_at,
      u.id as author_id,
      u.name as author_name
    FROM articles a
    JOIN "user" u ON a.author_id = u.id
    ORDER BY a.published_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    dek: row.dek,
    readingTimeMinutes: row.reading_time_minutes,
    publishedAt: row.published_at,
    author: {
      id: row.author_id,
      name: row.author_name,
    },
  }));
}
