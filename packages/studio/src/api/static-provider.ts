import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export interface StaticAsset {
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface StaticProvider {
  hasIndexHtml(): Promise<boolean>;
  readIndexHtml(): Promise<string | null>;
  readAsset(requestPath: string): Promise<StaticAsset | null>;
}

const contentTypes: Record<string, string> = {
  js: "application/javascript",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  json: "application/json",
  html: "text/html; charset=utf-8",
  woff2: "font/woff2",
  webmanifest: "application/manifest+json",
};

function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return contentTypes[ext] ?? "application/octet-stream";
}

export function createFilesystemStaticProvider(staticDir: string): StaticProvider {
  return {
    async hasIndexHtml(): Promise<boolean> {
      return existsSync(join(staticDir, "index.html"));
    },
    async readIndexHtml(): Promise<string | null> {
      const indexPath = join(staticDir, "index.html");
      if (!existsSync(indexPath)) {
        return null;
      }
      return readFile(indexPath, "utf-8");
    },
    async readAsset(requestPath: string): Promise<StaticAsset | null> {
      const normalizedPath = normalize(requestPath).replace(/^[/\\]+/, "");
      const filePath = join(staticDir, normalizedPath);
      try {
        const content = await readFile(filePath);
        return {
          content: new Uint8Array(content),
          contentType: getContentType(filePath),
        };
      } catch {
        return null;
      }
    },
  };
}

export function createEmbeddedStaticProvider(assets: {
  readonly indexHtml?: string;
  readonly files: Readonly<Record<string, StaticAsset>>;
}): StaticProvider {
  return {
    async hasIndexHtml(): Promise<boolean> {
      return typeof assets.indexHtml === "string";
    },
    async readIndexHtml(): Promise<string | null> {
      return assets.indexHtml ?? null;
    },
    async readAsset(requestPath: string): Promise<StaticAsset | null> {
      const normalizedPath = requestPath.replace(/^[/\\]+/, "");
      return assets.files[normalizedPath] ?? null;
    },
  };
}
