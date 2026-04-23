import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFilesystemStaticProvider } from "./static-provider.js";

const tempDirs: string[] = [];

async function createTempStaticDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-static-provider-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
