import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import { executeBashTool, executeFileReadTool, executeFileWriteTool, executeFileEditTool } from "./real-tool-handlers";

describe("real tool handlers", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "novelfork-real-tools-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe("Bash tool", () => {
    it("executes a shell command and returns stdout", async () => {
      const result = await executeBashTool({ command: "echo hello world", workDir });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain("hello world");
      expect(result.data).toMatchObject({ exitCode: 0 });
      expect((result.data as { stdout: string }).stdout).toContain("hello world");
    });

    it("returns error for failed commands", async () => {
      const result = await executeBashTool({ command: "exit 42", workDir });

      expect(result.ok).toBe(false);
      expect(result.data).toMatchObject({ exitCode: 42 });
    });

    it("rejects dangerous patterns", async () => {
      const result = await executeBashTool({ command: "rm -rf /", workDir });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("dangerous");
    });

    it("tracks cwd changes after cd commands", async () => {
      const subDir = join(workDir, "subdir");
      await mkdir(subDir);

      const result = await executeBashTool({ command: `cd subdir`, workDir });

      expect(result.ok).toBe(true);
      // On Windows with Git Bash, pwd -P returns Unix-style paths
      expect(result.newWorkDir).toBeTruthy();
      expect(result.newWorkDir).toContain("subdir");
    });
  });

  describe("FileRead tool", () => {
    it("reads a file within the work directory", async () => {
      await writeFile(join(workDir, "test.txt"), "文件内容", "utf-8");

      const result = await executeFileReadTool({ path: "test.txt", workDir });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ content: "文件内容" });
    });

    it("rejects paths outside work directory", async () => {
      const result = await executeFileReadTool({ path: "../../etc/passwd", workDir });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside");
    });
  });

  describe("FileWrite tool", () => {
    it("writes a file within the work directory", async () => {
      const result = await executeFileWriteTool({ path: "output.txt", content: "新内容", workDir });

      expect(result.ok).toBe(true);
      expect(await readFile(join(workDir, "output.txt"), "utf-8")).toBe("新内容");
    });

    it("creates parent directories", async () => {
      const result = await executeFileWriteTool({ path: "sub/dir/file.txt", content: "嵌套", workDir });

      expect(result.ok).toBe(true);
      expect(existsSync(join(workDir, "sub/dir/file.txt"))).toBe(true);
    });

    it("rejects paths outside work directory", async () => {
      const result = await executeFileWriteTool({ path: "../escape.txt", content: "恶意", workDir });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside");
    });
  });

  describe("FileEdit tool", () => {
    it("replaces text in a file", async () => {
      await writeFile(join(workDir, "edit.txt"), "hello world\nfoo bar\n", "utf-8");

      const result = await executeFileEditTool({
        path: "edit.txt",
        oldText: "foo bar",
        newText: "baz qux",
        workDir,
      });

      expect(result.ok).toBe(true);
      expect(await readFile(join(workDir, "edit.txt"), "utf-8")).toBe("hello world\nbaz qux\n");
    });

    it("fails when old text not found", async () => {
      await writeFile(join(workDir, "edit.txt"), "hello world\n", "utf-8");

      const result = await executeFileEditTool({
        path: "edit.txt",
        oldText: "not found",
        newText: "replacement",
        workDir,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not-found");
    });
  });
});
