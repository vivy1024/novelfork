import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type SQLiteDatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  close(): void;
};

type SQLiteCtor = new (filename: string) => SQLiteDatabaseLike;

function loadNodeSqlite(): SQLiteCtor | null {
  try {
    const mod = require("node:sqlite") as { DatabaseSync?: SQLiteCtor };
    return mod.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

function loadBunSqlite(): SQLiteCtor | null {
  try {
    const mod = require("bun:sqlite") as { Database?: SQLiteCtor };
    return mod.Database ?? null;
  } catch {
    return null;
  }
}

export function hasSqliteRuntime(): boolean {
  return loadNodeSqlite() !== null || loadBunSqlite() !== null;
}

export function createSqliteDatabase(filename: string): SQLiteDatabaseLike {
  const NodeDatabase = loadNodeSqlite();
  if (NodeDatabase !== null) {
    return new NodeDatabase(filename);
  }

  const BunDatabase = loadBunSqlite();
  if (BunDatabase !== null) {
    return new BunDatabase(filename);
  }

  throw new Error("No supported SQLite runtime found. Expected node:sqlite or bun:sqlite.");
}
