import { Hono } from "hono";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const UPLOAD_DIR = join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".novelfork", "uploads");

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

  return app;
}
