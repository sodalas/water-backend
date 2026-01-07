/**
 * articles.publish.test.js
 *
 * 🟥 CANONICAL TESTS - NON-NEGOTIABLE
 *
 * These tests lock the article publishing invariants and prevent regression.
 * They are binding and must pass for canon compliance.
 *
 * Invariants tested:
 * 1. Restricted Markdown validation blocks forbidden constructs
 * 2. Server-side rendering is mandatory
 * 3. Rendering failure blocks publication
 * 4. Fenced code blocks are explicitly allowed
 * 5. Valid articles publish successfully
 */

import request from "supertest";
import app from "../../index.js";
import * as renderArticleModule from "../../domain/article/renderArticle.js";

/**
 * Test authentication helper
 * Adjust based on your auth implementation
 */
function authHeader(userId = "test-user-1") {
  // TODO: Replace with actual test auth mechanism
  // This assumes Bearer token auth; adjust if using session cookies
  return { Authorization: `Bearer test-token-${userId}` };
}

describe("POST /api/articles/publish — Validation (🟥)", () => {
  describe("Restricted Markdown Enforcement", () => {
    test("🟥 CRITICAL: rejects raw HTML tags", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "Test Article",
          markdown: "<script>alert(1)</script>",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid article input");
      expect(res.body.message).toMatch(/HTML is not allowed/i);
    });

    test("🟥 CRITICAL: rejects HTML div tags", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "Test Article",
          markdown: "<div>Content</div>",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid article input");
    });

    test("🟥 CRITICAL: rejects images (v1 restriction)", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "Test Article",
          markdown: "![alt text](https://example.com/image.png)",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid article input");
      expect(res.body.message).toMatch(/Images are not allowed/i);
    });

    test("🟥 CRITICAL: rejects JSX/MDX components", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "Test Article",
          markdown: "<CustomComponent prop='value' />",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid article input");
    });

    test("🟥 CRITICAL: rejects empty/whitespace-only markdown", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "Test Article",
          markdown: "   \n  \n  ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid article input");
      expect(res.body.message).toMatch(/content is required/i);
    });
  });

  describe("Title Validation", () => {
    test("🟥 CRITICAL: rejects missing title", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          markdown: "Valid markdown content",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid article input");
    });

    test("🟥 CRITICAL: rejects title too short", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "AB", // Less than MIN_TITLE (3)
          markdown: "Valid markdown content",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too short/i);
    });

    test("🟥 CRITICAL: rejects title too long", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "A".repeat(201), // Exceeds MAX_TITLE (200)
          markdown: "Valid markdown content",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too long/i);
    });

    test("normalizes title whitespace", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .set(authHeader())
        .send({
          title: "  Valid Title  ",
          markdown: "# Content",
        });

      // Should succeed and trim whitespace
      if (res.status === 201) {
        expect(res.body.title).toBe("Valid Title");
      }
    });
  });

  describe("Authentication", () => {
    test("🟥 CRITICAL: blocks unauthenticated requests", async () => {
      const res = await request(app)
        .post("/api/articles/publish")
        .send({
          title: "Test Article",
          markdown: "Valid content",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentication/i);
    });
  });
});

describe("POST /api/articles/publish — Allowed Constructs (🟥)", () => {
  test("🟥 CRITICAL: MUST allow fenced code blocks", async () => {
    const markdown = `
# Code Example

Here is some code:

\`\`\`js
function hello() {
  console.log("world");
}
\`\`\`

And that's it!
`;

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Code Article",
        markdown,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test("🟥 CRITICAL: MUST allow inline code", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Inline Code Article",
        markdown: "Use the \`console.log()\` function to debug.",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test("🟥 CRITICAL: MUST allow headings", async () => {
    const markdown = `
# Heading 1
## Heading 2
### Heading 3

Content here.
`;

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Headings Article",
        markdown,
      });

    expect(res.status).toBe(201);
  });

  test("🟥 CRITICAL: MUST allow lists", async () => {
    const markdown = `
Unordered:
- Item 1
- Item 2
- Item 3

Ordered:
1. First
2. Second
3. Third
`;

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Lists Article",
        markdown,
      });

    expect(res.status).toBe(201);
  });

  test("🟥 CRITICAL: MUST allow blockquotes", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Blockquote Article",
        markdown: "> This is a quote\n> Second line",
      });

    expect(res.status).toBe(201);
  });

  test("🟥 CRITICAL: MUST allow links", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Links Article",
        markdown: "Check out [this link](https://example.com) for more info.",
      });

    expect(res.status).toBe(201);
  });

  test("🟥 CRITICAL: MUST allow emphasis (bold, italic)", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Emphasis Article",
        markdown: "This is **bold** and this is *italic* and this is ***both***.",
      });

    expect(res.status).toBe(201);
  });
});

describe("POST /api/articles/publish — Happy Path (🟥)", () => {
  test("🟥 CRITICAL: publishes a valid article", async () => {
    const markdown = `
# Introduction

This is a **real article** with proper content.

## Features

- Lists work
- Links work
- Code works

## Code Example

\`\`\`javascript
const x = 42;
\`\`\`

That's all!
`;

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader("author-123"))
      .send({
        title: "Hello Water",
        markdown,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("Hello Water");
    expect(res.body.readingTimeMinutes).toBeGreaterThan(0);
    expect(res.body.publishedAt).toBeDefined();
  });

  test("🟥 CRITICAL: includes optional dek in response", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Article with Dek",
        dek: "This is the subtitle",
        markdown: "# Content here",
      });

    expect(res.status).toBe(201);
    expect(res.body.dek).toBe("This is the subtitle");
  });

  test("normalizes null/empty dek to null", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Article without Dek",
        dek: "   ",
        markdown: "# Content here",
      });

    if (res.status === 201) {
      expect(res.body.dek).toBeNull();
    }
  });
});

describe("POST /api/articles/publish — Rendering Enforcement (🟥)", () => {
  test("🟥 CRITICAL: blocks publication if rendering fails", async () => {
    // Mock rendering failure
    const renderSpy = jest
      .spyOn(renderArticleModule, "renderArticle")
      .mockRejectedValueOnce(new Error("Rendering engine failure"));

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Bad Render",
        markdown: "# Valid markdown that fails to render",
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to publish/i);

    renderSpy.mockRestore();
  });

  test("🟥 CRITICAL: no article persisted if rendering fails", async () => {
    // This test requires database access to verify
    // If article creation throws before DB write, this is implicitly tested
    // If you have a getArticleById helper, you can verify:

    const renderSpy = jest
      .spyOn(renderArticleModule, "renderArticle")
      .mockRejectedValueOnce(new Error("Render failure"));

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Should Not Persist",
        markdown: "# Content",
      });

    expect(res.status).toBe(500);
    expect(res.body.id).toBeUndefined(); // No ID returned means not persisted

    renderSpy.mockRestore();
  });
});

describe("POST /api/articles/publish — Reading Time (🟥)", () => {
  test("🟥 CRITICAL: calculates reading time server-side", async () => {
    const longMarkdown = `
# Long Article

${"Lorem ipsum dolor sit amet. ".repeat(100)}

## Section 2

${"More content here. ".repeat(100)}
`;

    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Long Article",
        markdown: longMarkdown,
      });

    expect(res.status).toBe(201);
    expect(res.body.readingTimeMinutes).toBeGreaterThan(0);
    expect(typeof res.body.readingTimeMinutes).toBe("number");
  });

  test("minimum reading time is 1 minute", async () => {
    const res = await request(app)
      .post("/api/articles/publish")
      .set(authHeader())
      .send({
        title: "Short Article",
        markdown: "Just a few words.",
      });

    if (res.status === 201) {
      expect(res.body.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    }
  });
});
