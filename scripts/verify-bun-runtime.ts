import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildRuntimeVerificationSummary,
  extractStartupSmokeChecks,
  type RuntimeVerificationCheckResult,
} from "../packages/studio/src/api/lib/verify-bun-runtime.ts";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const bunExecutable = process.execPath;
const smokeTimeoutMs = 30_000;
const smokePollIntervalMs = 250;
const smokeBookTitle = `Bun Smoke Book ${Date.now()}`;
const smokePort = 4571 + Math.floor(Math.random() * 200);

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runCommand(command: readonly string[]): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function commandCheck(
  name: string,
  category: RuntimeVerificationCheckResult["category"],
  result: CommandResult,
): RuntimeVerificationCheckResult {
  return {
    name,
    ok: result.exitCode === 0,
    category,
    ...(result.exitCode === 0
      ? { detail: result.stdout.trim() || "ok" }
      : { detail: (result.stderr.trim() || result.stdout.trim() || `exit=${result.exitCode}`).slice(0, 400) }),
  };
}

async function readStream(stream: ReadableStream<Uint8Array> | null | undefined, sink: string[]): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const parts = buffered.split(/\r?\n/);
      buffered = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (line) sink.push(line);
      }
    }
    buffered += decoder.decode();
    const tail = buffered.trim();
    if (tail) sink.push(tail);
  } finally {
    reader.releaseLock();
  }
}

async function waitForHttp(url: string, timeoutMs: number, logLines: readonly string[]): Promise<Response> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      return response;
    } catch {
      await Bun.sleep(smokePollIntervalMs);
    }
  }
  throw new Error(`Timed out waiting for ${url}\n${logLines.join("\n")}`);
}

async function runStartupSmoke(): Promise<RuntimeVerificationCheckResult[]> {
  const smokeRoot = await mkdtemp(join(tmpdir(), "novelfork-bun-runtime-"));
  const sessionStoreDir = join(smokeRoot, ".runtime", "sessions");
  await writeFile(join(smokeRoot, ".env"), "NOVELFORK_LLM_API_KEY=\n", "utf-8");

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const proc = Bun.spawn([bunExecutable, "run", "main.ts", `--root=${smokeRoot}`, `--port=${smokePort}`], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NOVELFORK_LLM_API_KEY: "",
      NOVELFORK_SESSION_STORE_DIR: sessionStoreDir,
    },
  });

  const stdoutTask = readStream(proc.stdout, stdoutLines);
  const stderrTask = readStream(proc.stderr, stderrLines);
  const baseUrl = `http://127.0.0.1:${smokePort}`;

  try {
    const homepage = await waitForHttp(`${baseUrl}/`, smokeTimeoutMs);
    const homepageHtml = await homepage.text();
    const providerStatusResponse = await fetch(`${baseUrl}/api/providers/status`);
    const providerStatusPayload = await providerStatusResponse.json() as { status?: { hasUsableModel?: boolean } };
    const createBookResponse = await fetch(`${baseUrl}/api/books/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: smokeBookTitle,
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });
    const createBookPayload = await createBookResponse.json() as { bookId?: string; status?: string };
    if (createBookPayload.bookId) {
      await fetch(`${baseUrl}/api/books/${createBookPayload.bookId}`, { method: "DELETE" });
    }

    proc.kill();
    await proc.exited;
    await Promise.all([stdoutTask, stderrTask]);

    const startupChecks = extractStartupSmokeChecks([...stdoutLines, ...stderrLines]);
    return [
      startupChecks.runtimeCheck,
      startupChecks.storageCheck,
      {
        name: "homepage smoke",
        ok: homepage.ok && homepageHtml.includes("NovelFork Studio"),
        category: "frontend",
        detail: homepage.ok ? "title=NovelFork Studio" : `status=${homepage.status}`,
      },
      startupChecks.websocketCheck,
      {
        name: "provider status smoke",
        ok: providerStatusResponse.ok && providerStatusPayload.status?.hasUsableModel === false,
        category: "provider",
        detail: `hasUsableModel=${String(providerStatusPayload.status?.hasUsableModel ?? "missing")}`,
      },
      startupChecks.providerCheck,
      {
        name: "book create smoke",
        ok: createBookResponse.ok && createBookPayload.status === "creating" && typeof createBookPayload.bookId === "string",
        category: "frontend",
        detail: createBookPayload.bookId ?? `status=${createBookResponse.status}`,
      },
      startupChecks.environmentCheck,
    ];
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await Promise.all([stdoutTask, stderrTask]).catch(() => undefined);
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

const checks: RuntimeVerificationCheckResult[] = [];
checks.push(commandCheck(
  "core typecheck",
  "runtime",
  await runCommand([bunExecutable, "packages/core/node_modules/typescript/bin/tsc", "-p", "packages/core/tsconfig.json", "--noEmit"]),
));
checks.push(commandCheck(
  "studio client typecheck",
  "frontend",
  await runCommand([bunExecutable, "packages/studio/node_modules/typescript/bin/tsc", "-p", "packages/studio/tsconfig.json", "--noEmit"]),
));
checks.push(commandCheck(
  "studio server typecheck",
  "runtime",
  await runCommand([bunExecutable, "packages/studio/node_modules/typescript/bin/tsc", "-p", "packages/studio/tsconfig.server.json", "--noEmit"]),
));
checks.push(commandCheck(
  "bun storage verification",
  "storage",
  await runCommand([bunExecutable, "scripts/verify-bun-storage.ts"]),
));
checks.push(...await runStartupSmoke());

const summary = buildRuntimeVerificationSummary(checks);
console.log(JSON.stringify(summary));
if (!summary.ok) {
  process.exitCode = 1;
}
