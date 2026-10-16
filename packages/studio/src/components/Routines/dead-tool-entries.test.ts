import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// T-19：Runtime 里并不存在 EnterWorktree / ExitWorktree 两个工具（团队工人与领导者共用书籍根目录）。
// 套路页的工具清单与权限快捷项若仍列出它们，用户会看到点不动的死入口，/load enter_worktree 也指向不存在的工具。
const DEAD_TOOLS = ["EnterWorktree", "ExitWorktree", "enter_worktree", "exit_worktree"];

function readSource(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

describe("套路页不列出 Runtime 里不存在的工具（T-19）", () => {
  it.each(["ToolsTab.tsx", "PermissionsTab.tsx"])("%s 不含 EnterWorktree / ExitWorktree", (file) => {
    const source = readSource(file);
    for (const name of DEAD_TOOLS) {
      expect({ file, name, found: source.includes(name) }).toEqual({ file, name, found: false });
    }
  });

  it("ToolsTab 仍保留真实存在的工具（防止误删过头）", () => {
    const source = readSource("ToolsTab.tsx");
    for (const name of ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "TodoWrite"]) {
      expect(source).toContain(`name: "${name}"`);
    }
  });

  it("PermissionsTab 的快捷项仍保留真实存在的工具", () => {
    const source = readSource("PermissionsTab.tsx");
    for (const name of ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "TodoWrite"]) {
      expect(source).toContain(`"${name}"`);
    }
  });
});
