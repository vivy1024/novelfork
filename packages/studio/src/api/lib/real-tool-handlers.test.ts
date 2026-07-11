import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { executeBashTool, executeFileReadTool, executeFileWriteTool, executeFileEditTool } from "./real-tool-handlers";

async function waitForFile(path: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for file: ${path}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

class ControllableBashChild extends EventEmitter {
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn(() => true);

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  emitClose(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("close", code, signal);
  }
}

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

    it.each([
      { label: "successful", code: 0, expectedOk: true, expectedError: undefined },
      { label: "non-zero", code: 42, expectedOk: false, expectedError: "command-failed" },
    ])("waits for close and final output after a $label exit", async ({ code, expectedOk, expectedError }) => {
      const child = new ControllableBashChild();
      const spawnProcess = vi.fn(() => child as unknown as ChildProcess);
      let settled = false;
      const resultPromise = executeBashTool({
        command: "controlled",
        workDir,
        spawnProcess,
      }).then((result) => {
        settled = true;
        return result;
      });
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());

      child.stdout.write("before-exit\n");
      child.emitExit(code);
      await Promise.resolve();
      expect(settled).toBe(false);

      child.stdout.write("after-exit-before-close\n");
      child.emitClose(code);
      const result = await resultPromise;

      expect(result.ok).toBe(expectedOk);
      expect(result.error).toBe(expectedError);
      expect(result.data).toMatchObject({ exitCode: code, stdout: expect.stringContaining("after-exit-before-close") });
    });

    it("settles a spawn error exactly once after close", async () => {
      const child = new ControllableBashChild();
      const spawnProcess = vi.fn(() => child as unknown as ChildProcess);
      let settled = false;
      const resultPromise = executeBashTool({
        command: "spawn-error",
        workDir,
        spawnProcess,
      }).then((result) => {
        settled = true;
        return result;
      });
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());

      child.emit("error", new Error("injected spawn failure"));
      await Promise.resolve();
      expect(settled).toBe(false);

      child.emitClose(-2);
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        error: "spawn-failed",
        data: { error: "injected spawn failure" },
      });
      child.emitExit(0);
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

    it("kills the real parent-child process tree on abort and reports stopped only after exit", async () => {
      const controller = new AbortController();
      const childPidPath = join(workDir, "bash-tree-child.pid");
      let childPid: number | undefined;
      const execution = executeBashTool({
        command: `node -e "require('node:fs').writeFileSync('bash-tree-child.pid', String(process.pid)); setInterval(() => {}, 1000)"`,
        workDir,
        timeoutMs: 2_000,
        signal: controller.signal,
      });

      try {
        await waitForFile(childPidPath);
        childPid = Number(await readFile(childPidPath, "utf-8"));
        expect(Number.isInteger(childPid)).toBe(true);
        expect(isProcessAlive(childPid)).toBe(true);

        controller.abort();
        const result = await execution;

        expect(result).toMatchObject({
          ok: false,
          error: "stopped",
          data: expect.objectContaining({ stopReason: "abort" }),
        });
        expect(isProcessAlive(childPid)).toBe(false);
      } finally {
        if (childPid && isProcessAlive(childPid)) {
          try { process.kill(childPid, "SIGKILL"); } catch { /* cleanup only */ }
        }
      }
    }, 5_000);

    it("kills the real parent-child process tree on timeout before returning timeout", async () => {
      const childPidPath = join(workDir, "bash-timeout-child.pid");
      let childPid: number | undefined;
      const execution = executeBashTool({
        command: `node -e "require('node:fs').writeFileSync('bash-timeout-child.pid', String(process.pid)); setInterval(() => {}, 1000)"`,
        workDir,
        timeoutMs: 500,
      });

      try {
        await waitForFile(childPidPath);
        childPid = Number(await readFile(childPidPath, "utf-8"));
        expect(isProcessAlive(childPid)).toBe(true);

        const result = await execution;

        expect(result).toMatchObject({
          ok: false,
          error: "timeout",
          data: expect.objectContaining({ stopReason: "timeout" }),
        });
        expect(isProcessAlive(childPid)).toBe(false);
      } finally {
        if (childPid && isProcessAlive(childPid)) {
          try { process.kill(childPid, "SIGKILL"); } catch { /* cleanup only */ }
        }
      }
    }, 5_000);
  });

  describe("FileRead tool", () => {
    it("reads a file within the work directory", async () => {
      await writeFile(join(workDir, "test.txt"), "文件内容", "utf-8");

      const result = await executeFileReadTool({ path: "test.txt", workDir });

      expect(result.ok).toBe(true);
      // content 以 cat -n 行号格式返回（与 Claude Code FileRead 对齐）
      expect(result.data).toMatchObject({ content: `${String(1).padStart(6, " ")}\t文件内容` });
    });

    it("rejects paths outside work directory", async () => {
      const result = await executeFileReadTool({ path: "../../etc/passwd", workDir });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("path-sandbox-violation");
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
      expect(result.error).toContain("path-sandbox-violation");
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
