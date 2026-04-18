#!/usr/bin/env bun
/**
 * NovelFork Entry Point
 * 单文件 exe 入口，内嵌前端资源和后端服务器
 */

import { serve } from "bun";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const app = new Hono();
const PORT = process.env.NOVELFORK_PORT || 7778;

// 获取 exe 所在目录
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");

// CORS
app.use("/*", cors());

// 健康检查
app.get("/health", (c) => c.json({ status: "ok", version: "0.0.1" }));

// 静态文件服务（前端）
app.use("/*", serveStatic({ root: publicDir }));

// Fallback to index.html for SPA routing
app.get("/*", (c) => {
  const indexPath = join(publicDir, "index.html");
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf-8");
    return c.html(html);
  }
  return c.text("NovelFork not found", 404);
});

console.log(`
  ⛏  NovelFork v0.0.1
  ➜  http://localhost:${PORT}
  ➜  mode: production (Bun compiled)
`);

serve({
  fetch: app.fetch,
  port: PORT,
});
