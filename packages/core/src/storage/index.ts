export type {
  StorageAdapter,
  TruthFilesData,
  ControlDocuments,
  WriteSnapshot,
  MutationOp,
  ChapterUpdate,
  MutationSet,
  WriteLockHandle,
  ChapterStatus as StorageChapterStatus,
} from "./adapter.js";

export { FileSystemStorageAdapter } from "./fs-adapter.js";

export { closeStorageDatabase, createStorageDatabase, getStorageDatabase, initializeStorageDatabase, type CreateStorageDatabaseOptions, type StorageDatabase } from "./db.js";
export { runStorageMigrations, type RunStorageMigrationsOptions, type StorageMigrationResult } from "./migrations-runner.js";
export { sessions, sessionMessages, sessionMessageCursors, kvStore, drizzleMigrations } from "./schema.js";
