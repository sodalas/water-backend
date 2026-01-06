/**
 * estimateReadingTime.js
 *
 * SERVER-SIDE ONLY READING TIME ESTIMATION (🟥 MANDATORY)
 *
 * Computes reading time based on word count.
 * Assumes 200 words per minute (standard reading speed).
 *
 * Invariants:
 * - MUST run on server only
 * - Client MUST NEVER compute reading time
 * - Minimum 1 minute
 *
 * @param {string} markdown - Raw Markdown content
 * @returns {number} Estimated reading time in minutes
 */
export function estimateReadingTime(markdown) {
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}
