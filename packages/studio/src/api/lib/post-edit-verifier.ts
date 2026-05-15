import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface VerificationResult {
  passed: boolean;
  output: string;
  command: string;
  durationMs: number;
}

/**
 * Run a verification command after file edits.
 * Spawns the command in a shell with a timeout.
 */
export async function runPostEditVerification(options: {
  command: string;
  workDir: string;
  timeoutMs?: number;
}): Promise<VerificationResult> {
  const { command, workDir, timeoutMs = 30000 } = options;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(command, [], {
      shell: true,
      cwd: workDir,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      // Prefer stderr for error output, fall back to stdout
      const output = (stderr || stdout).slice(-2000);
      resolve({
        passed: code === 0,
        output,
        command,
        durationMs: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      resolve({
        passed: false,
        output: err.message,
        command,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

/**
 * Auto-detect a verification command based on project files in workDir.
 */
export function detectVerificationCommand(workDir: string): string | null {
  // TypeScript project
  if (existsSync(join(workDir, "tsconfig.json"))) {
    return "bunx tsc --noEmit";
  }

  // Rust project
  if (existsSync(join(workDir, "Cargo.toml"))) {
    return "cargo check";
  }

  // Python project
  if (existsSync(join(workDir, "pyproject.toml")) || existsSync(join(workDir, "setup.py"))) {
    return "python -m py_compile";
  }

  // Go project
  if (existsSync(join(workDir, "go.mod"))) {
    return "go build ./...";
  }

  return null;
}
