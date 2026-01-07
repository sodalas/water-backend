// src/domain/article/validateArticleInput.js
/**
 * validateArticleInput.js
 *
 * Canonical article input validation (🟥).
 * Enforces "restricted-markdown" at ingestion time.
 *
 * Note:
 * - Sanitization still happens in renderArticle() via rehype-sanitize.
 * - This validator rejects *disallowed authoring constructs* early to keep canon tight.
 */

const MAX_TITLE = 200;
const MIN_TITLE = 3;

export function normalizeArticleTitle(title) {
  if (typeof title !== "string") throw new Error("Title must be a string");
  const t = title.trim();
  if (t.length < MIN_TITLE) throw new Error("Title too short");
  if (t.length > MAX_TITLE) throw new Error("Title too long");
  return t;
}

export function normalizeArticleDek(dek) {
  if (dek == null) return null;
  if (typeof dek !== "string") throw new Error("Dek must be a string");
  const d = dek.trim();
  return d.length ? d : null;
}

/**
 * Restricted Markdown (v1)
 * Allowed intent: prose + headings + lists + blockquotes + links + emphasis.
 * Disallowed: raw HTML, images, MDX, scripts, etc.
 */
export function validateRestrictedMarkdown(markdown) {
  if (typeof markdown !== "string") throw new Error("Markdown must be a string");
  const m = markdown.trim();
  if (!m.length) throw new Error("Article content is required");

  // Reject raw HTML tags (keeps authoring constrained; sanitize still runs later)
  if (/<\/?[a-z][\s\S]*>/i.test(m)) {
    throw new Error("HTML is not allowed in article body");
  }

  // Disallow images in v1
  if (/!\[[^\]]*]\([^)]*\)/.test(m)) {
    throw new Error("Images are not allowed in v1 articles");
  }

  // Disallow MDX/JSX-ish angle-bracket components implicitly covered by HTML rule,
  // but keep an explicit message for common cases:
  if (/<[A-Z][A-Za-z0-9]*/.test(m)) {
    throw new Error("Components/JSX are not allowed in article body");
  }

  // (Optional) If you decide to disallow fenced code blocks in v1, uncomment:
  // if (/```/.test(m)) {
  //   throw new Error("Code blocks are not allowed in v1 articles");
  // }

  return true;
}
