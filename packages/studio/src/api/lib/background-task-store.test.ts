import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { closeStorageDatabase, initializeStorageDatabase } from "@vivy1024/novelfork-core";

import { getSessionStorageDatabase } from "./session-storage.js";

let storageRoot = "";
let previousStorageFallback: string | undefined;
let backgroundTaskStore: typeof import("./background-task-store.js");

async function loadStore() {
  backgroundTaskStore = await import("./background-task-store.js");
}

function sqlValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

async function seedLegacyRow(params: {
  id: string;
  ownerSessionId?: string | null;
  status: string;
  type?: string;
  configJson?: string | null;
  resultJson?: string | null;
  error?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}) {
  const storage = initializeStorageDatabase({ databasePath: join(storageRoot, "novelfork.db") });
  storage.sqlite.exec(`
CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'subagent',
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  config_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
INSERT INTO background_tasks (id, type, status, session_id, config_json, result_json, error, created_at, completed_at)
VALUES (${sqlValue(params.id)}, ${sqlValue(params.type ?? "subagent")}, ${sqlValue(params.status)}, ${sqlValue(params.ownerSessionId)}, ${sqlValue(params.configJson)}, ${sqlValue(params.resultJson)}, ${sqlValue(params.error)}, ${sqlValue(params.createdAt ?? "2026-05-02T00:00:00.000Z")}, ${sqlValue(params.completedAt ?? null)});
`);
  closeStorageDatabase();
}

beforeEach(async () => {
  closeStorageDatabase();
  previousStorageFallback = process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK;
  process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK = "1";
  storageRoot = await mkdtemp(join(tmpdir(), "novelfork-background-task-store-"));
  process.env.NOVELFORK_SESSION_STORE_DIR = storageRoot;
  await loadStore();
});

afterEach(async () => {
  closeStorageDatabase();
  delete process.env.NOVELFORK_SESSION_STORE_DIR;
  if (previousStorageFallback === undefined) {
    delete process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK;
  } else {
    process.env.NOVELFORK_FORCE_STORAGE_ORM_FALLBACK = previousStorageFallback;
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    storageRoot = "";
  }
});

describe("background-task-store", () => {
  it("requires the owner session for create/get/list/update and hides other owners", () => {
    expect(() =>
      backgroundTaskStore.createBackgroundTask({ id: "task-missing-owner" } as Parameters<typeof backgroundTaskStore.createBackgroundTask>[0]),
    ).toThrow(/controlOwnerSessionId/);
    expect(() => backgroundTaskStore.listBackgroundTasks(undefined as unknown as string)).toThrow(/controlOwnerSessionId/);

    const ownerA = backgroundTaskStore.createBackgroundTask({
      id: "task-a",
      controlOwnerSessionId: "session-owner-a",
      status: "running",
      configJson: JSON.stringify({ prompt: "alpha" }),
    });
    const ownerB = backgroundTaskStore.createBackgroundTask({
      id: "task-b",
      controlOwnerSessionId: "session-owner-b",
      status: "pending",
      configJson: JSON.stringify({ prompt: "beta" }),
    });

    expect(ownerA).toMatchObject({ id: "task-a", controlOwnerSessionId: "session-owner-a", sessionId: "session-owner-a", status: "running" });
    expect(ownerB).toMatchObject({ id: "task-b", controlOwnerSessionId: "session-owner-b", sessionId: "session-owner-b", status: "pending" });
    expect(    backgroundTaskStore.getBackgroundTask("task-a", "session-owner-a")).toMatchObject({ id: "task-a", controlOwnerSessionId: "session-owner-a" });
    expect(backgroundTaskStore.getBackgroundTask("task-a", "session-owner-b")).toBeNull();
    expect(backgroundTaskStore.listBackgroundTasks("session-owner-a").map((task) => task.id)).toEqual(["task-a"]);
    expect(backgroundTaskStore.listBackgroundTasks("session-owner-b").map((task) => task.id)).toEqual(["task-b"]);
    expect(backgroundTaskStore.updateBackgroundTask("task-a", "session-owner-b", { status: "completed" })).toBeNull();
    expect(backgroundTaskStore.getBackgroundTask("task-a", "session-owner-a")).toMatchObject({ status: "running" });
    expect(backgroundTaskStore.updateBackgroundTask("task-a", "session-owner-a", { status: "completed", terminalReason: "done" })).toMatchObject({
      status: "completed",
      terminalReason: "done",
    });

  });

  it("persists Bash stopping and stopped states without normalizing them to interrupted", () => {
    backgroundTaskStore.createBackgroundTask({
      id: "bash-lifecycle",
      controlOwnerSessionId: "session-owner-a",
      sessionId: "session-execution-a",
      type: "bash",
      status: "running",
    });

    expect(backgroundTaskStore.updateBackgroundTask("bash-lifecycle", "session-owner-a", {
      status: "stopping",
      terminalReason: "task-stop",
    })).toMatchObject({ status: "stopping", terminalReason: "task-stop" });
    expect(backgroundTaskStore.updateBackgroundTask("bash-lifecycle", "session-owner-a", {
      status: "stopped",
      completedAt: "2026-07-10T00:00:00.000Z",
      terminalReason: "stopped",
    })).toMatchObject({
      status: "stopped",
      sessionId: "session-execution-a",
      controlOwnerSessionId: "session-owner-a",
      terminalReason: "stopped",
    });
  });

  it("migrates legacy schema idempotently and backfills owner from legacy session_id", async () => {
    await seedLegacyRow({ id: "task-legacy-a", ownerSessionId: "session-owner-a", status: "running" });
    await seedLegacyRow({ id: "task-legacy-empty-owner", ownerSessionId: "", status: "running" });
    await seedLegacyRow({ id: "task-legacy-null-owner", ownerSessionId: null, status: "running" });

    expect(backgroundTaskStore.getBackgroundTask("task-legacy-a", "session-owner-a")).toMatchObject({
      id: "task-legacy-a",
      sessionId: "session-owner-a",
      controlOwnerSessionId: "session-owner-a",
      status: "running",
    });
    expect(backgroundTaskStore.listBackgroundTasks("session-owner-a").map((task) => task.id)).toEqual(["task-legacy-a"]);
    expect(backgroundTaskStore.listBackgroundTasks("session-owner-b")).toEqual([]);
    expect(backgroundTaskStore.getBackgroundTask("task-legacy-empty-owner", "session-owner-a")).toBeNull();
    expect(backgroundTaskStore.getBackgroundTask("task-legacy-null-owner", "session-owner-a")).toBeNull();
  });

  it("marks stale running, pending, stopping, and malformed rows as interrupted during startup recovery", async () => {
    await seedLegacyRow({ id: "task-running", ownerSessionId: "session-owner-a", status: "running" });
    await seedLegacyRow({ id: "task-pending", ownerSessionId: "session-owner-a", status: "pending" });
    await seedLegacyRow({ id: "task-stopping", ownerSessionId: "session-owner-a", status: "stopping" });
    await seedLegacyRow({ id: "task-completed", ownerSessionId: "session-owner-a", status: "completed", completedAt: "2026-05-02T00:00:10.000Z" });
    await seedLegacyRow({ id: "task-malformed", ownerSessionId: "session-owner-a", status: "glitched" });

    const firstRecovered = backgroundTaskStore.recoverInterruptedBackgroundTasks();

    expect(firstRecovered.map((task) => task.id)).toEqual(["task-malformed", "task-pending", "task-running", "task-stopping"]);
    expect(firstRecovered.map((task) => ({ id: task.id, status: task.status, terminalReason: task.terminalReason, terminalMetaJson: task.terminalMetaJson }))).toEqual([
      {
        id: "task-malformed",
        status: "interrupted",
        terminalReason: "startup-recovery",
        terminalMetaJson: JSON.stringify({ previousStatus: "glitched", recoveredFrom: "startup-recovery" }),
      },
      {
        id: "task-pending",
        status: "interrupted",
        terminalReason: "startup-recovery",
        terminalMetaJson: JSON.stringify({ previousStatus: "pending", recoveredFrom: "startup-recovery" }),
      },
      {
        id: "task-running",
        status: "interrupted",
        terminalReason: "startup-recovery",
        terminalMetaJson: JSON.stringify({ previousStatus: "running", recoveredFrom: "startup-recovery" }),
      },
      {
        id: "task-stopping",
        status: "interrupted",
        terminalReason: "startup-recovery",
        terminalMetaJson: JSON.stringify({ previousStatus: "stopping", recoveredFrom: "startup-recovery" }),
      },
    ]);
    expect(firstRecovered.every((task) => task.completedAt)).toBe(true);
    expect(backgroundTaskStore.getBackgroundTask("task-running", "session-owner-a")).toMatchObject({ status: "interrupted", terminalReason: "startup-recovery" });
    expect(backgroundTaskStore.getBackgroundTask("task-pending", "session-owner-a")).toMatchObject({ status: "interrupted", terminalReason: "startup-recovery" });
    expect(backgroundTaskStore.getBackgroundTask("task-stopping", "session-owner-a")).toMatchObject({ status: "interrupted", terminalReason: "startup-recovery" });
    expect(backgroundTaskStore.getBackgroundTask("task-malformed", "session-owner-a")).toMatchObject({ status: "interrupted", terminalReason: "startup-recovery" });
    expect(backgroundTaskStore.getBackgroundTask("task-completed", "session-owner-a")).toMatchObject({ status: "completed", terminalReason: null });
    expect(backgroundTaskStore.listBackgroundTasks("session-owner-b")).toEqual([]);

    const secondRecovered = backgroundTaskStore.recoverInterruptedBackgroundTasks();
    expect(secondRecovered).toEqual([]);
    expect(backgroundTaskStore.markInterruptedTasks()).toBe(0);
  });

  it("normalizes unknown stored data without leaking it across owners", async () => {
    await seedLegacyRow({ id: "task-legacy", ownerSessionId: "session-owner-a", status: "unknown-state", error: "legacy error" });

    expect(backgroundTaskStore.getBackgroundTask("task-legacy", "session-owner-a")).toMatchObject({
      id: "task-legacy",
      controlOwnerSessionId: "session-owner-a",
      status: "interrupted",
      terminalReason: "malformed-record",
      terminalMetaJson: JSON.stringify({ previousStatus: "unknown-state", recoveredFrom: "read-normalization" }),
    });
    expect(backgroundTaskStore.getBackgroundTask("task-legacy", "session-owner-b")).toBeNull();
    expect(backgroundTaskStore.listBackgroundTasks("session-owner-b")).toEqual([]);
  });

  it("keeps markInterruptedTasks as a compatibility wrapper for startup recovery", async () => {
    await seedLegacyRow({ id: "task-running", ownerSessionId: "session-owner-a", status: "running" });
    await seedLegacyRow({ id: "task-failed", ownerSessionId: "session-owner-a", status: "failed", completedAt: "2026-05-02T00:00:10.000Z" });

    expect(backgroundTaskStore.markInterruptedTasks()).toBe(1);
    expect(backgroundTaskStore.getBackgroundTask("task-running", "session-owner-a")).toMatchObject({
      status: "interrupted",
      terminalReason: "startup-recovery",
    });
    expect(backgroundTaskStore.getBackgroundTask("task-failed", "session-owner-a")).toMatchObject({ status: "failed", terminalReason: null });
    expect(backgroundTaskStore.markInterruptedTasks()).toBe(0);
  });
});
