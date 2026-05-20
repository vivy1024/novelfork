/**
 * 下载代理路由 — 流式转发 GitHub Release asset
 */

import { Hono } from "hono";
import { getAssetDownloadUrl } from "../github-proxy.js";

export function createDownloadRouter() {
  const app = new Hono();

  /**
   * GET /api/download/:version/:filename
   * 流式代理 GitHub Release asset 下载
   */
  app.get("/:version/:filename", async (c) => {
    const { version, filename } = c.req.param();

    // 安全检查：只允许下载 exe 和 sha256 文件
    if (!/\.(exe|sha256|zip|tar\.gz)$/i.test(filename)) {
      return c.json({ error: "File type not allowed" }, 403);
    }

    try {
      const githubUrl = await getAssetDownloadUrl(version, filename);
      if (!githubUrl) {
        return c.json({ error: "Asset not found", version, filename }, 404);
      }

      // 流式代理下载
      const headers: Record<string, string> = {
        "User-Agent": "novelfork-update-server/1.0",
      };
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const upstream = await fetch(githubUrl, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(300000), // 5 分钟超时（大文件）
      });

      if (!upstream.ok) {
        return c.json({ error: `Upstream returned ${upstream.status}` }, 502);
      }

      // 转发响应头
      const contentLength = upstream.headers.get("content-length");
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";

      const responseHeaders: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=86400", // 缓存 1 天
      };
      if (contentLength) {
        responseHeaders["Content-Length"] = contentLength;
      }

      // 流式转发 body
      return new Response(upstream.body, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error(`[download] Error proxying ${version}/${filename}:`, error);
      return c.json({ error: "Download proxy failed" }, 502);
    }
  });

  return app;
}
