import { readFile } from "node:fs/promises";

import {
  createStorageDatabase,
  runStorageMigrations,
} from "../packages/core/src/storage/index.js";

const runtimeSqliteFiles = [
  "../packages/core/src/storage/db.ts",
  "../packages/core/src/state/sqlite-driver.ts",
  "../packages/core/src/state/memory-db.ts",
] as const;
const forbiddenRuntimeSqliteDrivers = ["better-sqlite3", "node:sqlite"] as const;

for (const file of runtimeSqliteFiles) {
  const source = await readFile(new URL(file, import.meta.url), "utf-8");
  for (const driver of forbiddenRuntimeSqliteDrivers) {
    if (source.includes(driver)) {
      throw new Error(`Runtime SQLite file ${file} still references forbidden driver ${driver}`);
    }
  }
}

const storage = createStorageDatabase({ databasePath: ":memory:" });
try {
  const migrationResult = runStorageMigrations(storage);
  const row = storage.sqlite
    .prepare(`SELECT COUNT(*) AS "count" FROM "drizzle_migrations"`)
    .get() as { count: number } | undefined;

  const runInTransaction = storage.sqlite.transaction((value: string) => {
    storage.sqlite.prepare(`CREATE TABLE IF NOT EXISTS "bun_storage_probe" ("value" TEXT NOT NULL)`).run();
    storage.sqlite.prepare(`INSERT INTO "bun_storage_probe" ("value") VALUES (?)`).run(value);
    return storage.sqlite.prepare(`SELECT "value" FROM "bun_storage_probe" LIMIT 1`).get() as { value: string } | undefined;
  });

  const transactionRow = runInTransaction("ok");
  storage.checkpoint();

  if (!row || row.count <= 0) {
    throw new Error(`Expected storage migrations to be recorded, got ${JSON.stringify(row)}`);
  }
  if (transactionRow?.value !== "ok") {
    throw new Error(`Expected Bun transaction wrapper to return inserted row, got ${JSON.stringify(transactionRow)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: "bun",
    appliedMigrations: migrationResult.applied.length,
    recordedMigrations: row.count,
  }));
} finally {
  storage.close();
}
