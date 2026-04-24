export interface RuntimeModeHints {
  readonly bunAvailable?: boolean;
  readonly metaUrl?: string;
  readonly execPath?: string;
  readonly nodeEnv?: string;
}

export interface RuntimeModeSnapshot {
  readonly runtime: "bun" | "node";
  readonly isProd: boolean;
  readonly isCompiledBinary: boolean;
  readonly metaUrl: string;
  readonly exePath: string;
}

function hasBunRuntime(): boolean {
  return typeof (globalThis as typeof globalThis & { Bun?: unknown }).Bun !== "undefined";
}

export function detectRuntimeMode(hints: RuntimeModeHints = {}): RuntimeModeSnapshot {
  const bunAvailable = hints.bunAvailable ?? hasBunRuntime();
  const metaUrl = hints.metaUrl ?? import.meta.url;
  const exePath = hints.execPath ?? process.execPath;
  const nodeEnv = hints.nodeEnv ?? process.env.NODE_ENV;
  const normalizedExecPath = exePath.replace(/\\/g, "/").toLowerCase();
  const isBunCli = normalizedExecPath.endsWith("/bun.exe") || normalizedExecPath.endsWith("/bun");
  const isCompiledBinary = bunAvailable && metaUrl.startsWith("file:") && normalizedExecPath.endsWith(".exe") && !isBunCli;

  return {
    runtime: bunAvailable ? "bun" : "node",
    isProd: nodeEnv === "production" || isCompiledBinary,
    isCompiledBinary,
    metaUrl,
    exePath,
  };
}
