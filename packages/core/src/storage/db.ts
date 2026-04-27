import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import { createSqliteDatabase, type SQLiteChanges, type SQLiteDatabaseLike, type SQLiteStatementLike } from "../state/sqlite-driver.js";
import * as schema from "./schema.js";

const require = createRequire(import.meta.url);

type StorageOrmDatabase = BunSQLiteDatabase<typeof schema> | BetterSQLite3Database<typeof schema>;

export interface CreateStorageDatabaseOptions {
  databasePath: string;
}

export interface StorageSqliteStatement<T = unknown> {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | undefined;
  run(...params: unknown[]): SQLiteChanges;
  values(...params: unknown[]): unknown[][];
}

export interface StorageSqliteDatabase {
  readonly open: boolean;
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): StorageSqliteStatement<T>;
  query<T = unknown>(sql: string): StorageSqliteStatement<T>;
  run(sql: string, ...params: unknown[]): SQLiteChanges;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
  pragma(sql: string, options?: { readonly simple?: boolean }): unknown;
  close(): void;
}

export interface StorageDatabase {
  readonly databasePath: string;
  readonly sqlite: StorageSqliteDatabase;
  readonly db: StorageOrmDatabase;
  checkpoint(): void;
  close(): void;
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") return;
  mkdirSync(dirname(databasePath), { recursive: true });
}

function createStorageSqliteFacade(sqlite: SQLiteDatabaseLike): StorageSqliteDatabase {
  let open = true;
  const trackedStatements = new Set<{ finalize?: () => void }>();

  function trackStatement<T = unknown>(statement: SQLiteStatementLike<T>): StorageSqliteStatement<T> {
    const finalizable = statement as SQLiteStatementLike<T> & { finalize?: () => void };
    if (typeof finalizable.finalize === "function") {
      trackedStatements.add(finalizable);
    }
    return finalizable;
  }

  const facade: StorageSqliteDatabase = {
    get open() {
      return open;
    },
    exec(sql: string) {
      sqlite.exec(sql);
    },
    prepare<T = unknown>(sql: string) {
      return trackStatement(sqlite.prepare<T>(sql) as SQLiteStatementLike<T>);
    },
    query<T = unknown>(sql: string) {
      return trackStatement(sqlite.query<T>(sql) as SQLiteStatementLike<T>);
    },
    run(sql: string, ...params: unknown[]) {
      return sqlite.run(sql, ...params);
    },
    transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) {
      return sqlite.transaction(fn);
    },
    pragma(sql: string, options?: { readonly simple?: boolean }) {
      const statement = sql.trim().replace(/^PRAGMA\s+/iu, "");
      if (!statement) return undefined;
      if (/^(?:wal_checkpoint|optimize|foreign_keys\s*=|journal_mode\s*=|synchronous\s*=)/iu.test(statement)) {
        const row = facade.prepare<Record<string, unknown>>(`PRAGMA ${statement}`).get();
        if (!options?.simple) return row;
        return row ? Object.values(row)[0] : undefined;
      }
      const rows = facade.prepare<Record<string, unknown>>(`PRAGMA ${statement}`).all();
      if (!options?.simple) return rows;
      const row = rows[0];
      return row ? Object.values(row)[0] : undefined;
    },
    close() {
      if (!open) return;
      for (const statement of trackedStatements) {
        try {
          statement.finalize?.();
        } catch {
          // Ignore already-finalized or runtime-specific teardown failures.
        }
      }
      trackedStatements.clear();
      sqlite.close();
      open = false;
    },
  };

  return facade;
}

function createDrizzleDatabase(
  databasePath: string,
  sqliteConnection?: StorageSqliteDatabase,
): StorageOrmDatabase {
  if (process.versions.bun) {
    const { drizzle } = require("drizzle-orm/bun-sqlite") as {
      drizzle: (connection: string | object, config: { schema: typeof schema }) => StorageOrmDatabase;
    };
    return sqliteConnection ? drizzle(sqliteConnection as object, { schema }) : drizzle(databasePath, { schema });
  }

  const { drizzle } = require("drizzle-orm/better-sqlite3") as {
    drizzle: (connection: string, config: { schema: typeof schema }) => StorageOrmDatabase;
  };
  return drizzle(databasePath, { schema });
}

export function createStorageDatabase(options: CreateStorageDatabaseOptions): StorageDatabase {
  ensureDatabaseDirectory(options.databasePath);

  const sqliteConnection = createSqliteDatabase(options.databasePath);
  const sqlite = createStorageSqliteFacade(sqliteConnection);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  const db = createDrizzleDatabase(options.databasePath, sqlite);

  return {
    databasePath: options.databasePath,
    sqlite,
    db,
    checkpoint() {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    },
    close() {
      const client = (db as { $client?: { close?: () => void } }).$client;
      if (sqlite.open) {
        sqlite.pragma("wal_checkpoint(TRUNCATE)");
        sqlite.close();
      }
      if (client && client !== sqlite) {
        client.close?.();
      }
    },
  };
}

let storageDatabase: StorageDatabase | null = null;

export function initializeStorageDatabase(options: CreateStorageDatabaseOptions): StorageDatabase {
  if (storageDatabase?.sqlite.open) {
    if (storageDatabase.databasePath === options.databasePath) {
      return storageDatabase;
    }
    storageDatabase.close();
  }

  storageDatabase = createStorageDatabase(options);
  return storageDatabase;
}

export function getStorageDatabase(): StorageDatabase {
  if (!storageDatabase?.sqlite.open) {
    throw new Error("Storage database has not been initialized.");
  }
  return storageDatabase;
}

export function closeStorageDatabase(): void {
  storageDatabase?.close();
  storageDatabase = null;
}
