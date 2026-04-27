import { createRequire } from "node:module";

export interface SQLiteChanges {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SQLiteStatementLike<T = unknown> {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | undefined;
  run(...params: unknown[]): SQLiteChanges;
  values(...params: unknown[]): unknown[][];
}

export interface SQLiteDatabaseLike {
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): SQLiteStatementLike<T>;
  query<T = unknown>(sql: string): SQLiteStatementLike<T>;
  run(sql: string, ...params: unknown[]): SQLiteChanges;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): ((...args: TArgs) => TResult) & {
    deferred: (...args: TArgs) => TResult;
    immediate: (...args: TArgs) => TResult;
    exclusive: (...args: TArgs) => TResult;
  };
  close(): void;
}

const require = createRequire(import.meta.url);

export function hasSqliteRuntime(): boolean {
  if (process.versions.bun) return true;
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

export function createSqliteDatabase(filename: string): SQLiteDatabaseLike {
  if (process.versions.bun) {
    const { Database } = require("bun:sqlite") as {
      Database: new (filename?: string, options?: unknown) => SQLiteDatabaseLike;
    };
    return new Database(filename);
  }

  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (filename?: string, options?: object) => NodeSqliteDatabaseSync;
  };

  return new NodeSqliteDatabaseAdapter(new DatabaseSync(filename, {}));
}

interface NodeSqliteStatementSync {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): SQLiteChanges;
  setReturnArrays(enabled: boolean): NodeSqliteStatementSync;
}

interface NodeSqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatementSync;
  close(): void;
}

class NodeSqliteStatementAdapter<T = unknown> implements SQLiteStatementLike<T> {
  constructor(private readonly statement: NodeSqliteStatementSync) {}

  all(...params: unknown[]): T[] {
    this.statement.setReturnArrays(false);
    return this.statement.all(...params) as T[];
  }

  get(...params: unknown[]): T | undefined {
    this.statement.setReturnArrays(false);
    return this.statement.get(...params) as T | undefined;
  }

  run(...params: unknown[]): SQLiteChanges {
    return this.statement.run(...params);
  }

  values(...params: unknown[]): unknown[][] {
    this.statement.setReturnArrays(true);
    try {
      return this.statement.all(...params) as unknown[][];
    } finally {
      this.statement.setReturnArrays(false);
    }
  }
}

class NodeSqliteDatabaseAdapter implements SQLiteDatabaseLike {
  constructor(private readonly database: NodeSqliteDatabaseSync) {}

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare<T = unknown>(sql: string): SQLiteStatementLike<T> {
    return new NodeSqliteStatementAdapter<T>(this.database.prepare(sql));
  }

  query<T = unknown>(sql: string): SQLiteStatementLike<T> {
    return this.prepare<T>(sql);
  }

  run(sql: string, ...params: unknown[]): SQLiteChanges {
    return this.database.prepare(sql).run(...params);
  }

  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) {
    const execute = (mode: "deferred" | "immediate" | "exclusive", args: TArgs): TResult => {
      this.database.exec(`BEGIN ${mode.toUpperCase()}`);
      try {
        const result = fn(...args);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // ignore rollback failures while unwinding test transactions
        }
        throw error;
      }
    };

    const wrapped = ((...args: TArgs) => execute("deferred", args)) as ((...args: TArgs) => TResult) & {
      deferred: (...args: TArgs) => TResult;
      immediate: (...args: TArgs) => TResult;
      exclusive: (...args: TArgs) => TResult;
    };
    wrapped.deferred = (...args: TArgs) => execute("deferred", args);
    wrapped.immediate = (...args: TArgs) => execute("immediate", args);
    wrapped.exclusive = (...args: TArgs) => execute("exclusive", args);
    return wrapped;
  }

  close(): void {
    this.database.close();
  }
}
