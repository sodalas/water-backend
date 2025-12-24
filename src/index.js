import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 8000;

// 1. CORS (Strictly using process.env.FRONTEND_ORIGIN)
app.use(cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// 2. Better Auth Mount (Before JSON parser)
app.all("/api/auth/*", toNodeHandler(auth));

// 3. JSON Parsing (For application routes only)
app.use(express.json());

// 4. Application Routes
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log("Auth handler mounted at /api/auth/*");
});
