/**
 * NovelFork Update Server
 *
 * 轻量更新服务器，代理 GitHub Releases API 和 exe 下载。
 * 解决中国大陆用户无法直连 GitHub 的问题。
 *
 * API:
 *   GET /api/releases/latest?channel=stable&platform=windows-x64
 *   GET /api/releases?channel=stable&limit=5
 *   GET /api/download/:version/:filename
 *   GET /health
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createReleasesRouter } from "./routes/releases.js";
import { createDownloadRouter } from "./routes/download.js";

const app = new Hono();

// CORS — 允许 NovelFork Studio 跨域请求
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "novelfork-update-server", timestamp: new Date().toISOString() }));

// API routes
app.route("/api/releases", createReleasesRouter());
app.route("/api/download", createDownloadRouter());

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("[error]", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

const port = parseInt(process.env.PORT || "8080", 10);
console.log(`[novelfork-update-server] Starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
