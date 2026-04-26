/// <reference path="../types/bun-sqlite.d.ts" />

import { Database as BunDatabase } from "bun:sqlite";

export type SQLiteDatabaseLike = BunDatabase;

export function hasSqliteRuntime(): boolean {
  return Boolean(process.versions.bun);
}

export function createSqliteDatabase(filename: string): SQLiteDatabaseLike {
  return new BunDatabase(filename);
}
