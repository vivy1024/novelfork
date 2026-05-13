/**
 * Hook Executor — 执行用户配置的 shell hook 命令
 */
import { spawn } from "node:child_process";
import type { Hook } from "../../types/settings.js";

export interface HookContext {
  toolName: string;
  file?: string;
  workDir: string;
}

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 替换命令中的占位符并执行 shell 命令
 */
export async function executeHook(hook: Hook, context: HookContext): Promise<HookResult> {
  const timeout = hook.timeout ?? 10000;

  // 替换占位符
  let command = hook.command;
  command = command.replaceAll("{tool}", context.toolName);
  command = command.replaceAll("{file}", context.file ?? "");

  return new Promise<HookResult>((resolve) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

    const proc = spawn(shell, shellArgs, {
      cwd: context.workDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: stderr || err.message });
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * 获取匹配指定事件和工具名的 hooks
 */
export function getMatchingHooks(
  hooks: Hook[],
  event: Hook["event"],
  toolName: string,
): Hook[] {
  return hooks.filter((hook) => {
    if (hook.event !== event) return false;
    if (hook.toolName && hook.toolName !== toolName) return false;
    return true;
  });
}
