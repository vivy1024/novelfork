import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe("字号刻度防碎片化守卫测试 (font-size-guard)", () => {
  it("packages/novel-plugin/src 与 packages/studio/src 下的 .tsx 不得含有任意值字号 text-[...px]", () => {
    const workspaceRoot = path.resolve(__dirname, "../../..");
    const targetDirs = [
      path.join(workspaceRoot, "packages/novel-plugin/src"),
      path.join(workspaceRoot, "packages/studio/src"),
    ];

    const violations: { file: string; match: string; line: number }[] = [];
    const arbitraryPxPattern = /text-\[[0-9]+px\]/g;

    for (const dir of targetDirs) {
      const files = scanDirectory(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          const matches = line.match(arbitraryPxPattern);
          if (matches) {
            for (const match of matches) {
              violations.push({
                file: path.relative(workspaceRoot, file),
                match,
                line: index + 1,
              });
            }
          }
        });
      }
    }

    expect(
      violations,
      `发现 ${violations.length} 处任意值字号，请收拢为 text-2xs 或 Tailwind 标准刻度：\n` +
        violations.map((v) => `  ${v.file}:${v.line} -> ${v.match}`).join("\n"),
    ).toEqual([]);
  });
});
