/**
 * articleSanitizeSchema.js
 *
 * CANONICAL SANITIZATION SCHEMA (🟥 IMMUTABLE)
 *
 * This schema defines the ONLY HTML tags and attributes permitted
 * in rendered articles. Widening this schema requires a directive
 * amendment and security audit.
 *
 * DO NOT MODIFY without explicit authorization.
 */

import { defaultSchema } from "hast-util-sanitize";

export const articleSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "h1", "h2", "h3",
    "blockquote",
    "ul", "ol", "li",
    "pre", "code",
    "strong", "em",
    "a",
  ],
  attributes: {
    a: ["href", "title"],
    code: ["className"],
  },
};
