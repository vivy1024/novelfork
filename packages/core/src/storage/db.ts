/// <reference path="../types/bun-sqlite.d.ts" />

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database as BunDatabase, type Changes, type Statement } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema.js";

export interface CreateStorageDatabaseOptions {
  databasePath: string;
}

export interface StorageSqliteStatement<T = unknown> {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | undefined;
  run(...params: unknown[]): Changes;
  values(...params: unknown[]): unknown[][];
}

export interface StorageSqliteDatabase {
  readonly open: boolean;
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): StorageSqliteStatement<T>;
  query<T = unknown>(sql: string): StorageSqliteStatement<T>;
  run(sql: string, ...params: unknown[]): Changes;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
  pragma(sql: string, options?: { readonly simple?: boolean }): unknown;
  close(): void;
}

export interface StorageDatabase {
  readonly databasePath: string;
  readonly sqlite: StorageSqliteDatabase;
  readonly db: BunSQLiteDatabase<typeof schema>;
  checkpoint(): void;
  close(): void;
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") return;
  mkdirSync(dirname(databasePath), { recursive: true });
}

function createBunSqliteFacade(sqlite: BunDatabase): StorageSqliteDatabase {
  let open = true;

  return {
    get open() {
      return open;
    },
    exec(sql: string) {
      sqlite.exec(sql);
    },
    prepare<T = unknown>(sql: string) {
      return sqlite.prepare<T>(sql) as Statement<T>;
    },
    query<T = unknown>(sql: string) {
      return sqlite.query<T>(sql) as Statement<T>;
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
        const row = sqlite.prepare<Record<string, unknown>>(`PRAGMA ${statement}`).get();
        if (!options?.simple) return row;
        return row ? Object.values(row)[0] : undefined;
      }
      const rows = sqlite.prepare<Record<string, unknown>>(`PRAGMA ${statement}`).all();
      if (!options?.simple) return rows;
      const row = rows[0];
      return row ? Object.values(row)[0] : undefined;
    },
    close() {
      if (!open) return;
      sqlite.close();
      open = false;
    },
  };
}

export function createStorageDatabase(options: CreateStorageDatabaseOptions): StorageDatabase {
  ensureDatabaseDirectory(options.databasePath);

  const bunSqlite = new BunDatabase(options.databasePath);
  const sqlite = createBunSqliteFacade(bunSqlite);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(bunSqlite, { schema });

  return {
    databasePath: options.databasePath,
    sqlite,
    db,
    checkpoint() {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    },
    close() {
      if (sqlite.open) {
        sqlite.pragma("wal_checkpoint(TRUNCATE)");
        sqlite.close();
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
