/**
 * articles.js
 *
 * CANONICAL ARTICLE ROUTES (🟥 BINDING)
 *
 * Handles article publication and retrieval.
 *
 * Invariants:
 * - Publication MUST render on server
 * - Publication MUST block on rendering failure
 * - Reading MUST work without authentication
 * - Reading MUST serve only renderedHtml
 * - No client-side Markdown parsing
 */

import { Router } from "express";
import { renderArticle } from "../domain/article/renderArticle.js";
import { estimateReadingTime } from "../domain/article/estimateReadingTime.js";
import { generateOpenGraphMetadata } from "../domain/article/generateOpenGraphMetadata.js";
import {
  createArticle,
  getArticleById,
  getArticlesByAuthor,
  getRecentArticles,
} from "../infrastructure/article/ArticlePersistence.js";

const router = Router();

/**
 * POST /api/articles/publish
 *
 * Publishes a new article.
 *
 * Request body:
 * {
 *   title: string,
 *   dek?: string,
 *   markdown: string,
 *   originArticleId?: string
 * }
 *
 * Requires authentication.
 *
 * Returns:
 * {
 *   id: string,
 *   title: string,
 *   dek: string | null,
 *   readingTimeMinutes: number,
 *   publishedAt: string
 * }
 */
router.post("/articles/publish", async (req, res) => {
  // 🟥 MUST require authentication
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { title, dek, markdown, originArticleId } = req.body;

  // Validate required fields
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "Title is required" });
  }

  if (!markdown || typeof markdown !== "string" || markdown.trim().length === 0) {
    return res.status(400).json({ error: "Article content is required" });
  }

  try {
    // 🟥 MANDATORY: Server-side rendering
    // Rendering failure MUST block publication
    const renderedHtml = await renderArticle(markdown);

    // 🟥 MANDATORY: Server-side reading time
    const readingTimeMinutes = estimateReadingTime(markdown);

    // Create article in database
    const article = await createArticle({
      title: title.trim(),
      dek: dek ? dek.trim() : null,
      rawMarkdown: markdown,
      renderedHtml,
      readingTimeMinutes,
      authorId: req.user.id,
      originArticleId: originArticleId || null,
    });

    res.status(201).json({
      id: article.id,
      title: article.title,
      dek: article.dek,
      readingTimeMinutes: article.reading_time_minutes,
      publishedAt: article.published_at,
    });
  } catch (error) {
    console.error("[ARTICLE_PUBLISH_ERROR]", error);

    // 🟥 Rendering failure blocks publication
    res.status(500).json({
      error: "Failed to publish article",
      message:
        process.env.NODE_ENV === "production"
          ? undefined
          : error.message,
    });
  }
});

/**
 * GET /api/articles/:articleId
 *
 * Retrieves a published article by ID.
 *
 * 🟥 PUBLIC ENDPOINT - No authentication required
 * 🟥 Returns ONLY renderedHtml (never rawMarkdown)
 *
 * Returns:
 * {
 *   id: string,
 *   title: string,
 *   dek: string | null,
 *   html: string,
 *   readingTimeMinutes: number,
 *   publishedAt: string,
 *   author: { id: string, name: string },
 *   openGraph: { ... } // Open Graph metadata for sharing
 * }
 */
router.get("/articles/:articleId", async (req, res) => {
  const { articleId } = req.params;

  try {
    const article = await getArticleById(articleId);

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    // Generate Open Graph metadata for sharing
    const baseUrl = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
    const openGraph = generateOpenGraphMetadata(article, baseUrl);

    // 🟥 ONLY renderedHtml is served to readers
    res.json({
      ...article,
      openGraph,
    });
  } catch (error) {
    console.error("[ARTICLE_GET_ERROR]", error);
    res.status(500).json({ error: "Failed to retrieve article" });
  }
});

/**
 * GET /api/articles/author/:authorId
 *
 * Retrieves articles by a specific author.
 *
 * Query params:
 * - limit: number (default 20)
 * - offset: number (default 0)
 *
 * PUBLIC ENDPOINT - No authentication required
 */
router.get("/articles/author/:authorId", async (req, res) => {
  const { authorId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const articles = await getArticlesByAuthor(authorId, limit, offset);
    res.json({ articles, limit, offset });
  } catch (error) {
    console.error("[ARTICLES_BY_AUTHOR_ERROR]", error);
    res.status(500).json({ error: "Failed to retrieve articles" });
  }
});

/**
 * GET /api/articles/recent
 *
 * Retrieves recent published articles (public feed).
 *
 * Query params:
 * - limit: number (default 20)
 * - offset: number (default 0)
 *
 * PUBLIC ENDPOINT - No authentication required
 */
router.get("/articles/recent", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const articles = await getRecentArticles(limit, offset);
    res.json({ articles, limit, offset });
  } catch (error) {
    console.error("[RECENT_ARTICLES_ERROR]", error);
    res.status(500).json({ error: "Failed to retrieve articles" });
  }
});

export default router;
