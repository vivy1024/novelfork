type BuiltinProcess = typeof process & {
  getBuiltinModule?: (id: string) => unknown;
};

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

function getBuiltinModule<T>(id: string): T | null {
  try {
    const builtin = (process as BuiltinProcess).getBuiltinModule?.(id) as T | undefined;
    return builtin ?? null;
  } catch {
    return null;
  }
}

function loadNodeSqlite(): SQLiteCtor | null {
  const mod = getBuiltinModule<{ DatabaseSync?: SQLiteCtor }>("node:sqlite");
  return mod?.DatabaseSync ?? null;
}

function loadBunSqlite(): SQLiteCtor | null {
  const mod = getBuiltinModule<{ Database?: SQLiteCtor }>("bun:sqlite");
  return mod?.Database ?? null;
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
