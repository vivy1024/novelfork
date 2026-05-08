/**
 * Real tool handlers — actual file system and shell operations.
 *
 * These are the NovelFork equivalents of Claude Code CLI's BashTool/FileReadTool/FileWriteTool/FileEditTool.
 * All operations are bounded to the work directory and subject to dangerous pattern detection.
 */

import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";

import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";

// --- Dangerous pattern detection (对标 Claude Code CLI dangerousPatterns.ts) ---

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\//,  // rm -rf /
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//,  // rm -fr /
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /\bformat\s+[a-zA-Z]:/i,
  /\b(chmod|chown)\s+.*-R\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\b:(){ :|:& };:/,  // fork bomb
];

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

// --- Path validation (对标 Claude Code CLI pathValidation.ts) ---

function isPathWithinWorkDir(filePath: string, workDir: string): boolean {
  const absolutePath = resolve(workDir, filePath);
  const relativePath = relative(workDir, absolutePath);
  return !relativePath.startsWith("..") && !resolve(workDir, relativePath).includes("..");
}

function resolveToolPath(filePath: string, workDir: string): string | null {
  const absolutePath = resolve(workDir, filePath);
  if (!isPathWithinWorkDir(filePath, workDir)) return null;
  return absolutePath;
}

// --- Bash Tool ---

export interface BashToolInput {
  readonly command: string;
  readonly workDir: string;
  readonly timeoutMs?: number;
}

export async function executeBashTool(input: BashToolInput): Promise<SessionToolExecutionResult> {
  const { command, workDir, timeoutMs = 30000 } = input;

  if (isDangerousCommand(command)) {
    return {
      ok: false,
      error: "dangerous-command",
      summary: `命令被拒绝：检测到危险模式。`,
      data: { command, reason: "dangerous pattern detected" },
    };
  }

  return new Promise((resolve) => {
    exec(command, { cwd: workDir, timeout: timeoutMs, shell: "bash" }, (error, stdout, stderr) => {
      const exitCode = error?.code ?? (typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0);
      const numericExitCode = typeof exitCode === "number" ? exitCode : 1;

      if (numericExitCode !== 0) {
        resolve({
          ok: false,
          error: "command-failed",
          summary: stderr.trim() || stdout.trim() || `命令退出码 ${numericExitCode}`,
          data: { exitCode: numericExitCode, stdout, stderr, command },
        });
        return;
      }

      resolve({
        ok: true,
        summary: stdout.trim().slice(0, 200) || "(无输出)",
        data: { exitCode: 0, stdout, stderr, command },
      });
    });
  });
}

// --- FileRead Tool ---

export interface FileReadToolInput {
  readonly path: string;
  readonly workDir: string;
  readonly offset?: number;
  readonly limit?: number;
}

export async function executeFileReadTool(input: FileReadToolInput): Promise<SessionToolExecutionResult> {
  const resolved = resolveToolPath(input.path, input.workDir);
  if (!resolved) {
    return {
      ok: false,
      error: "path-outside-workdir",
      summary: `路径 ${input.path} 在工作目录外，拒绝读取。`,
      data: { path: input.path, workDir: input.workDir },
    };
  }

  try {
    const content = await readFile(resolved, "utf-8");
    const lines = content.split("\n");
    const offset = input.offset ?? 0;
    const limit = input.limit ?? lines.length;
    const sliced = lines.slice(offset, offset + limit).join("\n");

    return {
      ok: true,
      summary: `已读取 ${input.path}（${lines.length} 行）`,
      data: { content: sliced, totalLines: lines.length, path: input.path },
    };
  } catch (error) {
    return {
      ok: false,
      error: "read-failed",
      summary: `读取 ${input.path} 失败：${error instanceof Error ? error.message : String(error)}`,
      data: { path: input.path },
    };
  }
}

// --- FileWrite Tool ---

export interface FileWriteToolInput {
  readonly path: string;
  readonly content: string;
  readonly workDir: string;
}

export async function executeFileWriteTool(input: FileWriteToolInput): Promise<SessionToolExecutionResult> {
  const resolved = resolveToolPath(input.path, input.workDir);
  if (!resolved) {
    return {
      ok: false,
      error: "path-outside-workdir",
      summary: `路径 ${input.path} 在工作目录外，拒绝写入。`,
      data: { path: input.path, workDir: input.workDir },
    };
  }

  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, input.content, "utf-8");

    return {
      ok: true,
      summary: `已写入 ${input.path}（${input.content.length} 字符）`,
      data: { path: input.path, bytesWritten: input.content.length },
    };
  } catch (error) {
    return {
      ok: false,
      error: "write-failed",
      summary: `写入 ${input.path} 失败：${error instanceof Error ? error.message : String(error)}`,
      data: { path: input.path },
    };
  }
}

// --- FileEdit Tool ---

export interface FileEditToolInput {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly workDir: string;
}

export async function executeFileEditTool(input: FileEditToolInput): Promise<SessionToolExecutionResult> {
  const resolved = resolveToolPath(input.path, input.workDir);
  if (!resolved) {
    return {
      ok: false,
      error: "path-outside-workdir",
      summary: `路径 ${input.path} 在工作目录外，拒绝编辑。`,
      data: { path: input.path, workDir: input.workDir },
    };
  }

  try {
    const content = await readFile(resolved, "utf-8");

    if (!content.includes(input.oldText)) {
      return {
        ok: false,
        error: "old-text-not-found",
        summary: `在 ${input.path} 中未找到要替换的文本。`,
        data: { path: input.path, oldText: input.oldText.slice(0, 100) },
      };
    }

    const newContent = content.replace(input.oldText, input.newText);
    await writeFile(resolved, newContent, "utf-8");

    return {
      ok: true,
      summary: `已编辑 ${input.path}`,
      data: { path: input.path, replacements: 1 },
    };
  } catch (error) {
    return {
      ok: false,
      error: "edit-failed",
      summary: `编辑 ${input.path} 失败：${error instanceof Error ? error.message : String(error)}`,
      data: { path: input.path },
    };
  }
}
