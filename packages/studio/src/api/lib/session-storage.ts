import { join } from "node:path";

import {
  getStorageDatabase,
  initializeStorageDatabase,
  runStorageMigrations,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";

import { resolveRuntimeStorageDir } from "./runtime-storage-paths.js";

function getSessionStoreDiagnosticDir(): string {
  return process.env.NOVELFORK_SESSION_STORE_DIR?.trim() || resolveRuntimeStorageDir();
}

export function getSessionStoreDatabasePath(): string {
  return join(getSessionStoreDiagnosticDir(), "novelfork.db");
}

export function getSessionStorageDatabase(): StorageDatabase {
  const databasePath = getSessionStoreDatabasePath();
  try {
    const existing = getStorageDatabase();
    if (existing.databasePath === databasePath) {
      runStorageMigrations(existing);
      return existing;
    }
  } catch {
    // Initialize below when no singleton exists.
  }

  const storage = initializeStorageDatabase({ databasePath });
  runStorageMigrations(storage);
  return storage;
}
