// Sentry must be imported first
import { Sentry, setSentryUser } from "./sentry.js";

import express from "express";
import cors from "cors";
import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import composerDraftsRouter from "./routes/composerDrafts.js";
import publishRouter from "./routes/publish.js";
import homeRouter from "./routes/home.js";
import articlesRouter from "./routes/articles.js";
import healthRouter from "./routes/health.js";
import assertionsRouter from "./routes/assertions.js";
import threadRouter from "./routes/thread.js";
import reactionsRouter from "./routes/reactions.js";
import notificationsRouter from "./routes/notifications.js";
import { startDraftCleanupScheduler } from "./infrastructure/draft/DraftCleanup.js";
import { startIdempotencyCleanupScheduler } from "./infrastructure/idempotency/IdempotencyCleanup.js";
import { getGraphAdapter } from "./infrastructure/graph/getGraphAdapter.js";
import { pool } from "./db.js";
import { initWebSocketServer, closeWebSocketServer } from "./infrastructure/notifications/WebSocketServer.js";
import { initDeliveryService, startDeliveryWorker, stopDeliveryWorker } from "./domain/notifications/DeliveryService.js";

const app = express();
const PORT = process.env.PORT || 8000;

// Backend Correctness Sweep: Track schedulers for graceful shutdown
const schedulerHandles = [];

// 1. CORS (Strictly using process.env.FRONTEND_ORIGIN)
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 2. Logging & Auth Mount
if (process.env.NODE_ENV !== "production") {
  app.use("/api/auth", (req, res, next) => {
    console.log(`[DEV] ${req.method} ${req.originalUrl}`);
    next();
  });
}
app.use("/api/auth", toNodeHandler(auth));
console.log("[AUTH] Better Auth mounted at /api/auth with magicLink plugin");

// 2a. Redirect Guards (Backend should not serve SPA routes)
const redirectSPA = (req, res) => {
  const target = `${process.env.FRONTEND_ORIGIN}${req.path}`;
  console.log(`[REDIRECT] ${req.path} -> ${target}`);
  res.redirect(302, target);
};
app.get(["/app", "/write", "/login"], redirectSPA);

// 3. JSON Parsing (For application routes only)
app.use(express.json());

// 3a. Auth Middleware (Populate req.user)
app.use("/api", async (req, res, next) => {
  if (req.path.startsWith("/auth")) return next();

  // Test auth bypass: Only in non-production, allow X-Test-User-Id header
  // This enables load testing without requiring real auth sessions
  if (process.env.NODE_ENV !== "production") {
    const testUserId = req.headers["x-test-user-id"];
    if (testUserId) {
      req.user = {
        id: testUserId,
        email: `${testUserId}@loadtest.local`,
        name: testUserId,
      };
      req.session = { id: `test-session-${testUserId}` };
      // Don't set Sentry user for load test users to avoid noise
      return next();
    }
  }

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
      req.user = session.user;
      req.session = session.session;
      // Phase E.0: Set Sentry user context for error tracking
      setSentryUser(session.user);
    } else {
      // Clear Sentry user context for unauthenticated requests
      setSentryUser(null);
    }
  } catch (e) {
    // Warning: silently failing auth check?
    // Directive says "Better Auth middleware already resolved req.user.id".
    // This helper does exactly that.
    setSentryUser(null);
  }
  next();
});

// 4. Application Routes
app.use("/api", composerDraftsRouter);
app.use("/api", publishRouter);
app.use("/api", homeRouter);
app.use("/api", articlesRouter);
app.use("/api", healthRouter);
app.use("/api", assertionsRouter);
app.use("/api", threadRouter);
app.use("/api", reactionsRouter);
app.use("/api", notificationsRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 5. Sentry Error Handler (must be after all routes)
Sentry.setupExpressErrorHandler(app);

const server = app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Phase E.3: Initialize WebSocket server for real-time notifications
  initWebSocketServer(server);

  // Phase E.3/E.4: Initialize delivery service (WebSocket + Push) and start background worker
  await initDeliveryService();
  schedulerHandles.push(startDeliveryWorker(5000)); // Process outbox every 5 seconds

  // Backend Correctness Sweep: Store scheduler handles for cleanup
  schedulerHandles.push(startDraftCleanupScheduler());
  schedulerHandles.push(startIdempotencyCleanupScheduler());
});

// Backend Correctness Sweep: Graceful Shutdown Handler
async function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Received, starting graceful shutdown...`);

  // 1. Stop accepting new connections
  server.close(() => {
    console.log("[Shutdown] HTTP server closed");
  });

  // 2. Stop delivery worker
  stopDeliveryWorker();

  // 3. Close WebSocket server
  try {
    await closeWebSocketServer();
  } catch (error) {
    console.error("[Shutdown] Error closing WebSocket server:", error);
  }

  // 4. Clear all scheduler intervals
  for (const handle of schedulerHandles) {
    clearInterval(handle);
  }
  console.log(
    `[Shutdown] Cleared ${schedulerHandles.length} scheduler interval(s)`
  );

  // 5. Close Neo4j driver
  try {
    const graph = getGraphAdapter();
    await graph.close();
    console.log("[Shutdown] Neo4j driver closed");
  } catch (error) {
    console.error("[Shutdown] Error closing Neo4j:", error);
  }

  // 6. Close PostgreSQL pool
  try {
    await pool.end();
    console.log("[Shutdown] PostgreSQL pool closed");
  } catch (error) {
    console.error("[Shutdown] Error closing PG pool:", error);
  }

  // 7. Flush Sentry events before exit
  try {
    await Sentry.close(2000); // 2 second timeout
    console.log("[Shutdown] Sentry flushed");
  } catch (error) {
    console.error("[Shutdown] Error flushing Sentry:", error);
  }

  console.log("[Shutdown] Graceful shutdown complete");
  process.exit(0);
}

// Backend Correctness Sweep: Register signal handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
