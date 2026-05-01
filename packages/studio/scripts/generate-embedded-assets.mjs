/**
 * Generate embedded-assets.generated.ts by scanning dist/ directory.
 * Run after vite build, before server tsc compilation.
 * Usage: bun scripts/generate-embedded-assets.mjs
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = join(import.meta.dirname, "..", "dist");
const OUT = join(import.meta.dirname, "..", "src", "api", "embedded-assets.generated.ts");

const CONTENT_TYPES = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".html": "text/html; charset=utf-8",
};

async function scan(dir, prefix = "") {
  const result = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    const k = prefix + e.name;
    if (e.isDirectory()) {
      if (k === "api/") continue;
      Object.assign(result, await scan(p, k + "/"));
    } else {
      const buf = await readFile(p);
      const ct = CONTENT_TYPES[extname(e.name)] || "application/octet-stream";
      result[k] = { data: buf.toString("base64"), contentType: ct };
    }
  }
  return result;
}

const assets = await scan(DIST);
const indexKey = Object.keys(assets).find(k => k.endsWith("index.html") && !k.includes("assets/"));
const indexHtml = indexKey ? Buffer.from(assets[indexKey].data, "base64").toString("utf-8") : "";
delete assets[indexKey];

const code = `/* eslint-disable */
// Auto-generated — do not edit

const decodeBase64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64"));

export const embeddedIndexHtml: string = ${JSON.stringify(indexHtml)};

export const embeddedAssets: Record<string, { content: Uint8Array; contentType: string }> = {
${Object.entries(assets).map(([k, v]) => `  "${k}": { content: decodeBase64("${v.data}"), contentType: "${v.contentType}" }`).join(",\n")}
};
`;

await writeFile(OUT, code, "utf-8");
console.log(`Generated: ${Object.keys(assets).length + (indexHtml ? 1 : 0)} embedded assets`);
