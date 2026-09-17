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
  /**
   * 当前已进入的事务层数。嵌套层用 SAVEPOINT 而不是再 BEGIN 一次，
   * 与 bun:sqlite（实测支持嵌套）保持同一语义。
   */
  private transactionDepth = 0;

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
      // SQLite 不支持真正的嵌套事务：内层再 BEGIN 会直接报
      // "cannot start a transaction within a transaction"。better-sqlite3 与
      // bun:sqlite 都靠 SAVEPOINT 让 transaction() 可重入，本适配器必须一致——
      // 否则同一份业务代码（结算把 backfill 嵌在 commit 事务里）在 Bun 上跑得通、
      // 在 Node 上必挂，差异只在测试里暴露。
      const depth = this.transactionDepth;
      const savepoint = depth > 0 ? `novelfork_sp_${depth}` : null;
      if (savepoint) {
        this.database.exec(`SAVEPOINT ${savepoint}`);
      } else {
        this.database.exec(`BEGIN ${mode.toUpperCase()}`);
      }
      this.transactionDepth = depth + 1;
      try {
        const result = fn(...args);
        // 内层 RELEASE 只是把该 savepoint 合并进外层事务，并不真正提交；
        // 真正的 COMMIT 只发生在最外层。
        this.database.exec(savepoint ? `RELEASE ${savepoint}` : "COMMIT");
        return result;
      } catch (error) {
        try {
          if (savepoint) {
            // 必须 ROLLBACK TO 之后再 RELEASE：前者撤销内层改动但保留 savepoint，
            // 只有 RELEASE 才把它弹出栈，否则外层会留下悬挂的 savepoint。
            this.database.exec(`ROLLBACK TO ${savepoint}`);
            this.database.exec(`RELEASE ${savepoint}`);
          } else {
            this.database.exec("ROLLBACK");
          }
        } catch {
          // ignore rollback failures while unwinding test transactions
        }
        throw error;
      } finally {
        this.transactionDepth = depth;
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
