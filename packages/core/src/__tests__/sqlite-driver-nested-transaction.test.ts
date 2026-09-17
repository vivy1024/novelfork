/**
 * 事务可重入性契约。
 *
 * SQLite 本身不支持嵌套事务：内层再 BEGIN 会报
 * "cannot start a transaction within a transaction"。better-sqlite3 与 bun:sqlite
 * 都用 SAVEPOINT 让 transaction() 可重入，业务代码（例如章后结算把
 * backfillHookCausalLinks 嵌在 commitChapterStateDelta 的事务里）正是按这个语义写的。
 *
 * 曾经 Node 侧适配器无条件 BEGIN，于是同一份代码在 Bun 上跑得通、在 vitest（Node）
 * 下必挂——32 条结算测试因此全红，而产品因为跑 Bun 一直看不出问题。
 * 这里锁住三件事：嵌套能跑通、内层回滚不牵连外层已写入、外层回滚能连内层一起撤销。
 */
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteDatabase, type SQLiteDatabaseLike } from "../state/sqlite-driver.js";

const opened: SQLiteDatabaseLike[] = [];

function createDb(): SQLiteDatabaseLike {
  const db = createSqliteDatabase(":memory:");
  opened.push(db);
  db.exec("CREATE TABLE t (v INTEGER NOT NULL)");
  return db;
}

function rows(db: SQLiteDatabaseLike): number[] {
  return db.prepare<{ v: number }>("SELECT v FROM t ORDER BY v").all().map((r) => r.v);
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("SQLite 驱动的嵌套事务", () => {
  it("内层事务不再抛 cannot start a transaction within a transaction", () => {
    const db = createDb();
    const inner = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (2)").run();
    });
    const outer = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (1)").run();
      inner();
    });

    expect(() => outer()).not.toThrow();
    expect(rows(db)).toEqual([1, 2]);
  });

  it("内层失败只回滚内层，外层已写入的数据仍然提交", () => {
    const db = createDb();
    const inner = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (2)").run();
      throw new Error("inner-failed");
    });
    const outer = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (1)").run();
      try {
        inner();
      } catch {
        // 外层选择吞掉内层失败并继续——这正是 SAVEPOINT 存在的意义
      }
      db.prepare("INSERT INTO t VALUES (3)").run();
    });

    outer();
    expect(rows(db)).toEqual([1, 3]);
  });

  it("外层失败时连同内层已提交的 savepoint 一起回滚", () => {
    const db = createDb();
    const inner = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (2)").run();
    });
    const outer = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (1)").run();
      inner();
      throw new Error("outer-failed");
    });

    expect(() => outer()).toThrow("outer-failed");
    expect(rows(db)).toEqual([]);
  });

  it("嵌套解开后仍可开启新的顶层事务（深度计数没有泄漏）", () => {
    const db = createDb();
    const inner = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (2)").run();
      throw new Error("inner-failed");
    });
    const outer = db.transaction(() => {
      inner();
    });

    expect(() => outer()).toThrow("inner-failed");
    // 若 transactionDepth 在异常路径上没还原，这里会退化成 SAVEPOINT 而永不提交
    db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (9)").run();
    })();
    expect(rows(db)).toEqual([9]);
  });
});
