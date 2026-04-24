import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export interface StaticAsset {
  readonly content: Uint8Array;
  readonly contentType: string;
}

export type StaticProviderDescription =
  | { readonly source: "filesystem"; readonly root: string }
  | { readonly source: "embedded"; readonly assetCount: number };

export interface StaticProvider {
  describe(): StaticProviderDescription;
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
  webmanifest: "application/manifest+json",
  html: "text/html; charset=utf-8",
  woff2: "font/woff2",
};

function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return contentTypes[ext] ?? "application/octet-stream";
}

export function createFilesystemStaticProvider(staticDir: string): StaticProvider {
  const staticRoot = resolve(staticDir);

  return {
    describe(): StaticProviderDescription {
      return { source: "filesystem", root: staticRoot };
    },
    async hasIndexHtml(): Promise<boolean> {
      return existsSync(join(staticRoot, "index.html"));
    },
    async readIndexHtml(): Promise<string | null> {
      const indexPath = join(staticRoot, "index.html");
      if (!existsSync(indexPath)) {
        return null;
      }
      return readFile(indexPath, "utf-8");
    },
    async readAsset(requestPath: string): Promise<StaticAsset | null> {
      const normalizedPath = normalize(requestPath).replace(/^[/\\]+/, "");
      const filePath = resolve(staticRoot, normalizedPath);
      const relativePath = relative(staticRoot, filePath);

      if (
        normalizedPath.length === 0
        || isAbsolute(normalizedPath)
        || relativePath === ""
        || relativePath === ".."
        || relativePath.startsWith(`..${sep}`)
        || isAbsolute(relativePath)
      ) {
        return null;
      }

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
    describe(): StaticProviderDescription {
      return {
        source: "embedded",
        assetCount: Object.keys(assets.files).length + (typeof assets.indexHtml === "string" ? 1 : 0),
      };
    },
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
