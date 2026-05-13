/**
 * Real tool handlers — actual file system and shell operations.
 *
 * These are the NovelFork equivalents of Claude Code CLI's BashTool/FileReadTool/FileWriteTool/FileEditTool.
 * All operations are bounded to the work directory and subject to dangerous pattern detection.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { constants as fsConstants } from "node:fs";

import type { SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";

// --- Shell path resolution (Windows: Git Bash, not WSL) ---

let _cachedShellPath: string | null = null;

function resolveShellPath(): string {
  if (_cachedShellPath) return _cachedShellPath;

  if (process.platform !== "win32") {
    _cachedShellPath = process.env.SHELL || "/bin/bash";
    return _cachedShellPath;
  }

  // Windows: 按优先级查找 Git Bash
  const candidates = [
    process.env.NOVELFORK_SHELL,
    // Git for Windows 标准安装路径
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    // 用户级安装
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe` : null,
    // MSYS2
    "C:\\msys64\\usr\\bin\\bash.exe",
    // PATH 中的 bash（可能是 Git Bash 或 WSL）
    "bash",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "bash" || existsSync(candidate)) {
      _cachedShellPath = candidate;
      return candidate;
    }
  }

  // Fallback: 直接用 bash，让系统 PATH 解析
  _cachedShellPath = "bash";
  return "bash";
}

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

// --- Legacy encoding detection (Fix: legacyEncoding) ---

/**
 * 尝试 UTF-8 解码，如果出现 replacement character (U+FFFD) 则 fallback 到 GBK。
 * Bun 的 TextDecoder 支持 "gbk" 编码。
 */
function decodeWithFallback(buffer: Buffer): string {
  // 检测 BOM
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    // UTF-16 LE BOM
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    // UTF-16 BE BOM
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    // UTF-8 BOM
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }

  // 尝试 UTF-8
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  // Fallback: GBK（中文网文最常见的非 UTF-8 编码）
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return utf8; // GBK 解码器不可用时返回 UTF-8 结果
  }
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

export interface BashToolResult extends SessionToolExecutionResult {
  /** 对标 Claude: 命令执行后的新工作目录（如果 cd 改变了 cwd） */
  readonly newWorkDir?: string;
}

/**
 * 对标 Claude Code CLI Shell.ts:
 * - spawn('bash', ['-c', command]) 模式
 * - 环境变量: NOVELFORK=1, GIT_EDITOR=true
 * - cwd 追踪: 命令末尾追加 `; echo __NF_CWD__; pwd -P` 提取新 cwd
 * - 超时: SIGKILL 整个进程
 * - 进程树终止: kill(-pid) 发送到进程组
 */
export async function executeBashTool(input: BashToolInput): Promise<BashToolResult> {
  const { command, workDir, timeoutMs = 30000 } = input;

  if (isDangerousCommand(command)) {
    return {
      ok: false,
      error: "dangerous-command",
      summary: `命令被拒绝：检测到危险模式。`,
      data: { command, reason: "dangerous pattern detected" },
    };
  }

  // 对标 Claude: 追加 cwd 追踪命令（Claude 用临时文件，我们用 stdout marker）
  const CWD_MARKER = "__NF_CWD_MARKER__";
  const trackedCommand = `${command}; echo "${CWD_MARKER}"; pwd -P`;

  // Windows: 使用 Git Bash（不依赖 WSL）
  const shellPath = resolveShellPath();

  // Fix: refreshShellEnv — 如果配置启用，使用 login shell (-l) 以刷新环境变量
  let shellArgs = ["-c", trackedCommand];
  try {
    const { loadUserConfig } = await import("./user-config-service.js");
    const config = await loadUserConfig();
    if (config.runtimeControls?.refreshShellEnv) {
      shellArgs = ["-l", "-c", trackedCommand];
    }
  } catch { /* config load failure — use default shell args */ }

  return new Promise((resolveResult) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    // 对标 Claude: spawn 而非 exec，detached 用于进程组管理
    const child = spawn(shellPath, shellArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        NOVELFORK: "1",
        GIT_EDITOR: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32", // 对标 Claude: detached for process group kill
    });

    const timeout = setTimeout(() => {
      // 对标 Claude: tree-kill 整个进程组
      try {
        if (child.pid && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL"); // Kill process group
        } else {
          child.kill("SIGKILL");
        }
      } catch { child.kill("SIGKILL"); }

      resolveResult({
        ok: false,
        error: "timeout",
        summary: `命令超时（${timeoutMs}ms）`,
        data: { command, timeoutMs },
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolveResult({
        ok: false,
        error: "spawn-failed",
        summary: `命令启动失败：${error.message}`,
        data: { command, error: error.message },
      });
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      const rawStdout = Buffer.concat(stdout as unknown as Uint8Array[]).toString("utf-8");
      const stderrStr = Buffer.concat(stderr as unknown as Uint8Array[]).toString("utf-8");
      const exitCode = code ?? (signal ? 128 : 1);

      // 对标 Claude: 从 stdout 提取新 cwd
      let stdoutStr = rawStdout;
      let newWorkDir: string | undefined;
      const markerIndex = rawStdout.lastIndexOf(CWD_MARKER);
      if (markerIndex !== -1) {
        stdoutStr = rawStdout.slice(0, markerIndex).trimEnd();
        const cwdLine = rawStdout.slice(markerIndex + CWD_MARKER.length).trim();
        if (cwdLine && cwdLine !== workDir) {
          newWorkDir = cwdLine;
        }
      }

      if (exitCode !== 0) {
        resolveResult({
          ok: false,
          error: "command-failed",
          summary: stderrStr.trim() || stdoutStr.trim() || `命令退出码 ${exitCode}`,
          data: { exitCode, stdout: stdoutStr, stderr: stderrStr, command },
          newWorkDir,
        });
        return;
      }

      // Truncation: if stdout > 200 lines, keep head 50 + tail 50
      const BASH_MAX_LINES = 200;
      const BASH_HEAD = 50;
      const BASH_TAIL = 50;
      const stdoutLines = stdoutStr.split("\n");
      let displayStdout = stdoutStr;
      let fullOutput: string | undefined;
      if (stdoutLines.length > BASH_MAX_LINES) {
        const omitted = stdoutLines.length - BASH_HEAD - BASH_TAIL;
        const head = stdoutLines.slice(0, BASH_HEAD).join("\n");
        const tail = stdoutLines.slice(-BASH_TAIL).join("\n");
        displayStdout = `${head}\n\n... (省略 ${omitted} 行) ...\n\n${tail}`;
        fullOutput = stdoutStr;
      }

      resolveResult({
        ok: true,
        summary: displayStdout.trim().slice(0, 200) || "(无输出)",
        data: { exitCode: 0, stdout: displayStdout, stderr: stderrStr, command, ...(fullOutput ? { fullOutput } : {}) },
        newWorkDir,
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
    // Fix: legacyEncoding — 如果启用，尝试检测非 UTF-8 编码并用对应解码器
    let content: string;
    let legacyEncoding = false;
    try {
      const { loadUserConfig } = await import("./user-config-service.js");
      const config = await loadUserConfig();
      legacyEncoding = config.runtimeControls?.legacyEncoding === true;
    } catch { /* config load failure — default to UTF-8 */ }

    if (legacyEncoding) {
      const rawBuffer = await readFile(resolved);
      content = decodeWithFallback(rawBuffer);
    } else {
      content = await readFile(resolved, "utf-8");
    }

    const lines = content.split("\n");
    const totalLines = lines.length;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? lines.length;
    const sliced = lines.slice(offset, offset + limit).join("\n");

    // Truncation: if no explicit offset/limit and file > 500 lines, truncate
    const READ_MAX_LINES = 500;
    const callerSpecifiedRange = input.offset !== undefined || input.limit !== undefined;
    if (!callerSpecifiedRange && totalLines > READ_MAX_LINES) {
      const truncatedContent = lines.slice(0, READ_MAX_LINES).join("\n");
      const truncationNote = `\n\n（文件共 ${totalLines} 行，已显示前 ${READ_MAX_LINES} 行。用 offset/limit 参数读取后续内容。）`;
      return {
        ok: true,
        summary: `已读取 ${input.path}（${totalLines} 行，截断至前 ${READ_MAX_LINES} 行）`,
        data: { content: truncatedContent + truncationNote, totalLines, path: input.path, truncated: true, fullContent: sliced },
      };
    }

    return {
      ok: true,
      summary: `已读取 ${input.path}（${totalLines} 行）`,
      data: { content: sliced, totalLines, path: input.path },
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
