import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) return [path];
    return [];
  }));
  return nested.flat();
}

describe("Studio Next UI completion audit", () => {
  it("does not expose unimplemented feature copy in user-facing app-next source", async () => {
    const root = join(process.cwd(), "src", "app-next");
    const files = await collectSourceFiles(root);
    const offenders: string[] = [];
    const forbiddenPatterns = [
      /后续接入|暂未接入|即将推出|未接入|UnsupportedCapability/,
      /OpenAI-compatible|Anthropic-compatible/,
      /runtimeControls\.toolAccess/,
      />\{agent\.status\}<|>\{run\.status\}</,
    ];

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const relative = file.replace(root, "app-next");
      if (relative.endsWith("lib\\display-labels.ts") || relative.endsWith("lib/display-labels.ts")) continue;
      if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });
});
