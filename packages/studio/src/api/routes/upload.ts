import { Hono } from "hono";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, basename, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

const UPLOAD_DIR = join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".novelfork", "uploads");

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

export function createUploadRouter() {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || typeof file === "string") return c.json({ error: "No file provided" }, 400);

    await mkdir(UPLOAD_DIR, { recursive: true });
    const id = randomBytes(8).toString("hex");
    const ext = file.name?.split(".").pop() || "bin";
    const fileName = `${id}.${ext}`;
    const filePath = join(UPLOAD_DIR, fileName);

    const buffer = await file.arrayBuffer();
    await writeFile(filePath, new Uint8Array(buffer));

    return c.json({
      id,
      fileName: file.name,
      filePath,
      size: buffer.byteLength,
      mimeType: file.type || "application/octet-stream",
    });
  });

  // Serve uploaded files by filename
  app.get("/files/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (!filename) return c.text("Not found", 404);

    // Security: prevent directory traversal
    const safeFilename = basename(filename);
    const filePath = normalize(join(UPLOAD_DIR, safeFilename));
    if (!filePath.startsWith(UPLOAD_DIR)) return c.text("Forbidden", 403);

    if (!existsSync(filePath)) return c.text("Not found", 404);

    try {
      const data = await readFile(filePath);
      const ext = safeFilename.split(".").pop()?.toLowerCase() || "";
      const contentType = MIME_MAP[ext] || "application/octet-stream";
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  return app;
}
