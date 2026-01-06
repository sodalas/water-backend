/**
 * generateOpenGraphMetadata.js
 *
 * Generates Open Graph metadata for article sharing.
 *
 * 🟥 Invariant: Shared previews must represent articles faithfully,
 * not sensationally.
 *
 * Required metadata:
 * - og:title - Article title
 * - og:description - Article dek or excerpt
 * - og:url - Canonical article URL
 * - og:type - Always "article"
 *
 * Optional metadata:
 * - og:author - Author name
 * - article:published_time - Publication date
 * - article:author - Author profile URL
 */

/**
 * Generates Open Graph metadata tags for an article
 *
 * @param {Object} article - Article data
 * @param {string} article.id - Article ID
 * @param {string} article.title - Article title
 * @param {string} [article.dek] - Article subtitle/description
 * @param {string} article.publishedAt - Publication date
 * @param {Object} article.author - Author information
 * @param {string} article.author.name - Author name
 * @param {string} baseUrl - Base URL for the site (e.g., "https://water.app")
 * @returns {Object} Open Graph metadata object
 */
export function generateOpenGraphMetadata(article, baseUrl) {
  const articleUrl = `${baseUrl}/article/${article.id}`;

  // Extract description from dek or use title
  const description = article.dek || article.title;

  // Ensure description is not too long (recommended: 155-160 chars)
  const truncatedDescription =
    description.length > 160
      ? description.substring(0, 157) + "..."
      : description;

  return {
    // Required Open Graph tags
    "og:type": "article",
    "og:url": articleUrl,
    "og:title": article.title,
    "og:description": truncatedDescription,

    // Article-specific tags
    "article:published_time": article.publishedAt,
    "article:author": article.author.name,

    // Additional metadata for better previews
    "og:site_name": "Water",

    // Twitter Card (uses OG fallbacks but can be customized)
    "twitter:card": "summary",
    "twitter:title": article.title,
    "twitter:description": truncatedDescription,
  };
}

/**
 * Generates HTML meta tags from Open Graph metadata
 *
 * @param {Object} metadata - Open Graph metadata object
 * @returns {string} HTML meta tags
 */
export function generateMetaTags(metadata) {
  return Object.entries(metadata)
    .map(
      ([property, content]) =>
        `<meta property="${property}" content="${escapeHtml(content)}" />`
    )
    .join("\n");
}

/**
 * Escapes HTML entities in strings for safe meta tag content
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== "string") {
    return String(str);
  }

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
