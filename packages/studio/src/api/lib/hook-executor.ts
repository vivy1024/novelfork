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
 * 安全：占位符值通过环境变量传递，不直接注入命令字符串
 */
export async function executeHook(hook: Hook, context: HookContext): Promise<HookResult> {
  const timeout = hook.timeout ?? 10000;

  // 通过环境变量传递上下文（避免命令注入）
  const hookEnv = {
    ...process.env,
    HOOK_TOOL: context.toolName,
    HOOK_FILE: context.file ?? "",
    HOOK_WORKDIR: context.workDir,
  };

  // 命令中的 {tool}/{file} 替换为环境变量引用（仅用于显示，实际值从 env 读取）
  const command = hook.command
    .replaceAll("{tool}", "$HOOK_TOOL")
    .replaceAll("{file}", "$HOOK_FILE");

  return new Promise<HookResult>((resolve) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

    const proc = spawn(shell, shellArgs, {
      cwd: context.workDir,
      env: hookEnv,
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
