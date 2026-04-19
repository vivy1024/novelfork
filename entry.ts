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

// 自动打开浏览器（Chrome App Mode - 无界面）
setTimeout(() => {
  const url = `http://localhost:${PORT}`;

  // Windows: 使用 Chrome App Mode 打开（无地址栏、无标签页）
  if (process.platform === "win32") {
    // 尝试使用 Chrome App Mode
    const chromeArgs = [
      "--app=" + url,
      "--window-size=1440,900",
      "--disable-features=TranslateUI",
      "--no-first-run",
      "--no-default-browser-check"
    ];

    // 尝试常见的 Chrome 安装路径
    const chromePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe"
    ];

    let chromeOpened = false;
    for (const chromePath of chromePaths) {
      if (existsSync(chromePath)) {
        spawn(chromePath, chromeArgs, { detached: true, stdio: "ignore" });
        chromeOpened = true;
        console.log(`✅ Opened Chrome App Mode: ${chromePath}`);
        break;
      }
    }

    // Fallback: 使用默认浏览器
    if (!chromeOpened) {
      spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" });
      console.log(`⚠️  Chrome not found, using default browser`);
    }
  } else if (process.platform === "darwin") {
    // macOS: 使用 Chrome App Mode
    spawn("open", ["-a", "Google Chrome", "--args", "--app=" + url], { detached: true, stdio: "ignore" });
  } else {
    // Linux: 尝试 Chrome App Mode
    spawn("google-chrome", ["--app=" + url], { detached: true, stdio: "ignore" });
  }
}, 1000);

