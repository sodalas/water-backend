/**
 * renderArticle.js
 *
 * CANONICAL SERVER-SIDE ARTICLE RENDERING (🟥 MANDATORY)
 *
 * This is the ONLY permitted way to render article Markdown to HTML.
 *
 * Pipeline:
 *   Markdown → remark-parse → remark-gfm → remark-rehype
 *            → rehype-sanitize → rehype-stringify → HTML
 *
 * Invariants:
 * - MUST run on server only
 * - MUST sanitize with articleSanitizeSchema
 * - Rendering failure MUST block publication
 *
 * DO NOT:
 * - Call this from client
 * - Skip sanitization
 * - Add MDX support
 * - Add component rendering
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { articleSanitizeSchema } from "./articleSanitizeSchema.js";

/**
 * Renders Markdown to sanitized HTML
 *
 * @param {string} markdown - Raw Markdown input
 * @returns {Promise<string>} Sanitized HTML output
 * @throws {Error} If rendering fails (MUST block publication)
 */
export async function renderArticle(markdown) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, articleSanitizeSchema)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}
