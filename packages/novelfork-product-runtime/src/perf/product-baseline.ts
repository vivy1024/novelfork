import { cpus, platform, release, version } from "node:os";
import { getProductBootstrapContract } from "../services/product-contract";

type BenchResult = {
  readonly name: string;
  readonly iterations: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
};

const iterations = positiveInt(process.env.NOVELFORK_PARITY_BENCH_ITERATIONS, 30);
const warmup = positiveInt(process.env.NOVELFORK_PARITY_BENCH_WARMUP, 3);

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function fixture(size: number) {
  return {
    ...getProductBootstrapContract(),
    books: Array.from({ length: size }, (_, index) => ({
      id: `book-${index}`,
      title: `作品 ${index}`,
      status: "ready",
      capabilities: { read: true, create: false, update: false, delete: false, send: false, interrupt: false },
    })),
    narrators: Array.from({ length: size }, (_, index) => ({
      id: `narrator-${index}`,
      bookId: `book-${index}`,
      title: `叙述者 ${index}`,
      status: "idle",
      capabilities: { read: true, create: false, update: false, delete: false, send: true, interrupt: true },
    })),
  };
}

function workspaceFixture(chapters: number, contentSize: number) {
  return {
    book: fixture(1).books[0],
    resources: Array.from({ length: chapters }, (_, index) => ({
      id: `chapter:${index + 1}`,
      kind: "chapter",
      title: `第 ${index + 1} 章`,
      content: "x".repeat(contentSize),
      capabilities: { read: true, create: false, update: true, delete: false, send: false, interrupt: false },
    })),
    capabilities: { read: true, create: true, update: true, delete: false, send: false, interrupt: false },
  };
}

async function bench(name: string, fn: () => unknown | Promise<unknown>): Promise<BenchResult> {
  for (let index = 0; index < warmup; index += 1) await fn();
  const values: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    await fn();
    values.push(performance.now() - start);
  }
  return {
    name,
    iterations,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

const scenarios = [
  await bench("bootstrap-contract-and-100-books", () => JSON.stringify(fixture(100))),
  await bench("bootstrap-contract-and-10-books", () => JSON.stringify(fixture(10))),
  await bench("narrator-snapshot-1000-messages", () => {
    const messages = Array.from({ length: 1000 }, (_, index) => ({ id: `message-${index}`, role: index % 2 ? "assistant" : "user", content: "x".repeat(120) }));
    return JSON.stringify({ narrator: fixture(1).narrators[0], messages, version: messages.length });
  }),
  await bench("workspace-snapshot-100-chapters", () => JSON.stringify(workspaceFixture(100, 500))),
  await bench("ws-version-match-sync-ok", () => ({ type: "sync_ok", narratorId: "narrator-0", version: 1000 })),
  await bench("ws-catch-up-100-messages", () => JSON.stringify({ type: "catch_up", topLevel: Array.from({ length: 100 }, (_, index) => ({ message: { id: `message-${index}` } })) })),
  await bench("feature-flag-contract-snapshot", () => getProductBootstrapContract()),
];

console.log(JSON.stringify({
  benchmark: "novelfork-runtime-product-parity-phase-0",
  environment: { platform: platform(), os: release(), runtime: version(), cpu: cpus()[0]?.model ?? "unknown" },
  fixture: { iterations, warmup, books: [10, 100], messages: [100, 1000], chapters: [100], contentSize: 500 },
  results: scenarios,
}, null, 2));
