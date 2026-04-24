import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createEmbeddedStaticProvider, createFilesystemStaticProvider } from "./static-provider";

const tempDirs: string[] = [];

async function createTempStaticDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-static-provider-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("static-provider describe", () => {
  it("describes filesystem providers with source and root", () => {
    const provider = createFilesystemStaticProvider("D:/DESKTOP/novelfork/packages/studio/dist");

    expect(provider.describe()).toMatchObject({
      source: "filesystem",
      root: expect.stringContaining("packages"),
    });
  });

  it("describes embedded providers with asset count", () => {
    const provider = createEmbeddedStaticProvider({
      indexHtml: "<html></html>",
      files: {
        "assets/app.js": {
          content: new Uint8Array([1]),
          contentType: "application/javascript",
        },
        "manifest.webmanifest": {
          content: new Uint8Array([2]),
          contentType: "application/manifest+json",
        },
      },
    });

    expect(provider.describe()).toEqual({
      source: "embedded",
      assetCount: 3,
    });
  });
});

describe("filesystem static provider", () => {
  it("serves webmanifest assets with the correct content type", async () => {
    const staticDir = await createTempStaticDir();
    await writeFile(join(staticDir, "manifest.webmanifest"), '{"name":"NovelFork"}', "utf-8");

    const provider = createFilesystemStaticProvider(staticDir);
    const asset = await provider.readAsset("/manifest.webmanifest");

    expect(asset).not.toBeNull();
    expect(asset?.contentType).toBe("application/manifest+json");
  });

  it("rejects path traversal requests that escape the static directory", async () => {
    const parentDir = await createTempStaticDir();
    const staticDir = join(parentDir, "dist");
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(parentDir, "secret.txt"), "top-secret", "utf-8");
    await writeFile(join(staticDir, "index.html"), "<html>ok</html>", "utf-8");

    const provider = createFilesystemStaticProvider(staticDir);
    const asset = await provider.readAsset("/../secret.txt");

    expect(asset).toBeNull();
  });
});
