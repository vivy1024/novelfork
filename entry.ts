#!/usr/bin/env bun
/**
 * NovelFork Entry Point
 * 单文件 exe 入口，内嵌前端资源和后端服务器
 */

import { serve } from "bun";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";

const app = new Hono();
const PORT = process.env.NOVELFORK_PORT || 7788;

// 获取 exe 所在目录
const exeDir = process.execPath ? dirname(process.execPath) : process.cwd();
const publicDir = join(exeDir, "public");

console.log(`📂 Exe directory: ${exeDir}`);
console.log(`📂 Public directory: ${publicDir}`);
console.log(`📂 Public exists: ${existsSync(publicDir)}`);

// CORS
app.use("/*", cors());

// 健康检查
app.get("/health", (c) => c.json({ status: "ok", version: "0.0.1" }));

// 静态文件服务（前端）
app.use("/*", serveStatic({ root: publicDir }));

// Fallback to index.html for SPA routing
app.get("/*", async (c) => {
  const indexPath = join(publicDir, "index.html");
  if (existsSync(indexPath)) {
    const file = Bun.file(indexPath);
    const html = await file.text();
    return c.html(html);
  }
  return c.text(`NovelFork not found. Public dir: ${publicDir}, Index exists: ${existsSync(indexPath)}`, 404);
});

console.log(`
  ⛏  NovelFork v0.0.1
  ➜  http://localhost:${PORT}
  ➜  mode: production (Bun compiled)
  ➜  Opening browser...
`);

// 启动服务器
serve({
  fetch: app.fetch,
  port: PORT,
});

// 自动打开浏览器（无界面模式）
setTimeout(() => {
  const url = `http://localhost:${PORT}`;

  // Windows: 使用 start 命令打开默认浏览器
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" });
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" });
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  }
}, 1000);

