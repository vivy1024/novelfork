import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("repository hygiene", () => {
  it("does not keep local Studio workspace data in tracked source paths", () => {

    expect(existsSync(join(repoRoot, "packages", "studio", "novelfork.json"))).toBe(false);
    expect(existsSync(join(repoRoot, "packages", "studio", "books"))).toBe(false);
  });

  it("ignores generated local data and lockfiles that should not be committed", async () => {
    const gitignore = await readFile(join(process.cwd(), "..", "..", ".gitignore"), "utf-8");

    for (const pattern of [
      "packages/studio/books/",
      "packages/studio/novelfork.json",
      "*.db",
      "*.sqlite",
      "*.sqlite3",
      "*-wal",
      "*-shm",
      "bun.lock*",
      "yarn.lock",
    ]) {
      expect(gitignore).toContain(pattern);
    }
  });
});
