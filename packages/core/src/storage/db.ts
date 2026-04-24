import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

export interface CreateStorageDatabaseOptions {
  databasePath: string;
}

export interface StorageDatabase {
  readonly databasePath: string;
  readonly sqlite: Database.Database;
  readonly db: BetterSQLite3Database<typeof schema>;
  checkpoint(): void;
  close(): void;
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") return;
  mkdirSync(dirname(databasePath), { recursive: true });
}

export function createStorageDatabase(options: CreateStorageDatabaseOptions): StorageDatabase {
  ensureDatabaseDirectory(options.databasePath);

  const sqlite = new Database(options.databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(sqlite, { schema });

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
