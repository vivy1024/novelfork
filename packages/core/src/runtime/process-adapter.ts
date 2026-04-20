type ExecOptions = {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout?: number;
};

export type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal?: string | null;
};

export type ProcessHandle = {
  onStdout(handler: (data: string) => void): void;
  onStderr(handler: (data: string) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: (code: number | null) => void): void;
  writeStdin(data: string, callback?: (error?: Error | null) => void): void;
  kill(): void;
  isAlive(): boolean;
};

type BunRuntime = typeof globalThis & {
  Bun?: {
    spawn(options: {
      cmd: string[];
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: "pipe";
      stdout?: "pipe";
      stderr?: "pipe";
    }): {
      stdout: ReadableStream<Uint8Array>;
      stderr: ReadableStream<Uint8Array>;
      stdin: WritableStream<Uint8Array>;
      exited: Promise<number>;
      kill(): void;
      readonly killed?: boolean;
      readonly exitCode?: number | null;
    };
  };
};

function getBunRuntime(): BunRuntime["Bun"] | undefined {
  return (globalThis as BunRuntime).Bun;
}

function shellCommandArgs(command: string): string[] {
  if (process.platform === "win32") {
    return ["cmd", "/c", command];
  }
  return ["sh", "-lc", command];
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function wireStream(stream: ReadableStream<Uint8Array>, handler: (data: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    handler(decoder.decode(value, { stream: true }));
  }
  const finalChunk = decoder.decode();
  if (finalChunk) {
    handler(finalChunk);
  }
}

export async function execCommand(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const bun = getBunRuntime();
  if (bun) {
    const proc = bun.spawn({
      cmd: shellCommandArgs(command),
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = options.timeout && options.timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, options.timeout)
      : null;

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        collectStream(proc.stdout),
        collectStream(proc.stderr),
        proc.exited,
      ]);

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        signal: timedOut ? "SIGTERM" : null,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  const { exec } = await import("node:child_process");
  return await new Promise<ExecResult>((resolve, reject) => {
    const child = exec(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number" && !error.signal) {
        reject(error);
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: error && typeof error.code === "number" ? error.code : null,
        signal: error?.signal ?? null,
      });
    });

    if (options.timeout) {
      child.on("error", reject);
    }
  });
}

export async function execFileCommand(command: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
  const bun = getBunRuntime();
  if (bun) {
    const proc = bun.spawn({
      cmd: [command, ...args],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      collectStream(proc.stdout),
      collectStream(proc.stderr),
      proc.exited,
    ]);

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  const { execFile } = await import("node:child_process");
  return await new Promise<ExecResult>((resolve, reject) => {
    execFile(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: error && typeof error.code === "number" ? error.code : 0,
        signal: error?.signal ?? null,
      });
    });
  });
}

export async function spawnProcess(command: string, args: readonly string[], options: ExecOptions = {}): Promise<ProcessHandle> {
  const bun = getBunRuntime();
  if (bun) {
    const proc = bun.spawn({
      cmd: [command, ...args],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutHandlers = new Set<(data: string) => void>();
    const stderrHandlers = new Set<(data: string) => void>();
    const errorHandlers = new Set<(error: Error) => void>();
    const closeHandlers = new Set<(code: number | null) => void>();

    void wireStream(proc.stdout, (data) => {
      for (const handler of stdoutHandlers) handler(data);
    }).catch((error) => {
      for (const handler of errorHandlers) handler(error as Error);
    });

    void wireStream(proc.stderr, (data) => {
      for (const handler of stderrHandlers) handler(data);
    }).catch((error) => {
      for (const handler of errorHandlers) handler(error as Error);
    });

    void proc.exited.then((code) => {
      for (const handler of closeHandlers) handler(code);
    }).catch((error) => {
      for (const handler of errorHandlers) handler(error as Error);
    });

    const writer = proc.stdin.getWriter();

    return {
      onStdout(handler) {
        stdoutHandlers.add(handler);
      },
      onStderr(handler) {
        stderrHandlers.add(handler);
      },
      onError(handler) {
        errorHandlers.add(handler);
      },
      onClose(handler) {
        closeHandlers.add(handler);
      },
      writeStdin(data, callback) {
        writer.write(new TextEncoder().encode(data)).then(() => callback?.(null)).catch((error) => callback?.(error as Error));
      },
      kill() {
        proc.kill();
      },
      isAlive() {
        return !proc.killed;
      },
    };
  }

  const { spawn } = await import("node:child_process");
  const proc = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout?.setEncoding("utf-8");
  proc.stderr?.setEncoding("utf-8");

  return {
    onStdout(handler) {
      proc.stdout?.on("data", (data: string) => handler(data));
    },
    onStderr(handler) {
      proc.stderr?.on("data", (data: string) => handler(data));
    },
    onError(handler) {
      proc.on("error", handler);
    },
    onClose(handler) {
      proc.on("close", handler);
    },
    writeStdin(data, callback) {
      proc.stdin?.write(data, callback);
    },
    kill() {
      proc.kill();
    },
    isAlive() {
      return !proc.killed;
    },
  };
}
