import express from "express";
import cors from "cors";
import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import composerDraftsRouter from "./routes/composerDrafts.js";
import publishRouter from "./routes/publish.js";
import homeRouter from "./routes/home.js";
import { startDraftCleanupScheduler } from "./infrastructure/draft/DraftCleanup.js";

const app = express();
const PORT = process.env.PORT || 8000;

// 1. CORS (Strictly using process.env.FRONTEND_ORIGIN)
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 2. Better Auth Mount (Before JSON parser)
app.use("/api/auth", toNodeHandler(auth));

// 3. JSON Parsing (For application routes only)
app.use(express.json());

// 3a. Auth Middleware (Populate req.user)
app.use("/api", async (req, res, next) => {
  if (req.path.startsWith("/auth")) return next();
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
      req.user = session.user;
      req.session = session.session;
    }
  } catch (e) {
    // Warning: silently failing auth check?
    // Directive says "Better Auth middleware already resolved req.user.id".
    // This helper does exactly that.
  }
  next();
});

// 4. Application Routes
app.use("/api", composerDraftsRouter);
app.use("/api", publishRouter);
app.use("/api", homeRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Auth handler mounted at /api/auth/*");
  startDraftCleanupScheduler();
});
