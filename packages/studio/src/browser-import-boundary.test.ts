import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const BROWSER_IMPORT_PATTERN = /from\s+["'][^"']*api\/lib\//g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (fullPath === join(SOURCE_ROOT, "api")) {
        return [];
      }
      return collectSourceFiles(fullPath);
    }

    if (!/\.(ts|tsx|js|jsx)$/.test(fullPath) || /\.test\./.test(fullPath)) {
      return [];
    }

    return [fullPath];
  });
}

describe("browser/server import boundary", () => {
  it("does not let browser source import src/api/lib modules", () => {
    const offenders = collectSourceFiles(SOURCE_ROOT)
      .map((filePath) => {
        const content = readFileSync(filePath, "utf8");
        const matches = [...content.matchAll(BROWSER_IMPORT_PATTERN)].map((match) => match[0]);
        if (matches.length === 0) {
          return null;
        }

        return `${relative(SOURCE_ROOT, filePath)} => ${matches.join(", ")}`;
      })
      .filter((value): value is string => value !== null);

    expect(offenders).toEqual([]);
  });
});
