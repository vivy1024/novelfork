import { Hono } from "hono";
import { createShareLink, getShareEntry, deleteShareEntry } from "../lib/share-service.js";
import { readFile, stat } from "node:fs/promises";

export function createShareRouter() {
  const app = new Hono();

  // 创建分享链接
  app.post("/", async (c) => {
    const { path, expiresInMs } = await c.req.json<{ path: string; expiresInMs?: number }>();
    if (!path) return c.json({ error: "path is required" }, 400);
    try {
      await stat(path); // 验证文件存在
    } catch { return c.json({ error: "File not found" }, 404); }
    const result = createShareLink(path, expiresInMs);
    return c.json(result);
  });

  // 下载分享文件
  app.get("/:token", async (c) => {
    const entry = getShareEntry(c.req.param("token"));
    if (!entry) return c.json({ error: "Link expired or not found" }, 404);
    try {
      const content = await readFile(entry.filePath);
      return new Response(new Uint8Array(content), {
        headers: { "Content-Type": entry.mimeType, "Content-Disposition": `attachment; filename="${entry.fileName}"` },
      });
    } catch { return c.json({ error: "File no longer available" }, 410); }
  });

  // 删除分享链接
  app.delete("/:token", (c) => {
    deleteShareEntry(c.req.param("token"));
    return c.json({ success: true });
  });

  return app;
}
