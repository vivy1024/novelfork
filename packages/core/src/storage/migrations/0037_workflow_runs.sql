-- 0037 创作工作流运行：产品持有的工序状态机。
--
-- 叙述者仍是唯一执行者；它在每道工序能用什么工具、必须交什么产物、何时被拦，
-- 由这里的运行状态决定。状态迁移只在后端发生，模型只能提交候选、报告阻塞。
--
-- 一个叙述者同时只允许一个进行中的运行（部分唯一索引）。
-- revision 做乐观并发：前端审批与模型提交会并发打同一个运行，错配即拒绝。

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id"                   TEXT PRIMARY KEY NOT NULL,
  "book_id"              TEXT NOT NULL,
  "chapter_number"       INTEGER NOT NULL,
  "recipe_id"            TEXT NOT NULL,
  -- 启动时冻结整份配方，之后作者改配方不影响进行中的运行
  "recipe_snapshot_json" TEXT NOT NULL,
  "narrator_id"          TEXT NOT NULL,
  -- running | awaiting_approval | blocked | done | cancelled
  "status"               TEXT NOT NULL,
  "current_step_id"      TEXT,
  "revision"             INTEGER NOT NULL DEFAULT 0,
  "created_at"           INTEGER NOT NULL,
  "updated_at"           INTEGER NOT NULL,
  "finished_at"          INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_runs_active_narrator"
  ON "workflow_runs" ("narrator_id")
  WHERE "status" IN ('running', 'awaiting_approval', 'blocked');

CREATE INDEX IF NOT EXISTS "idx_workflow_runs_book"
  ON "workflow_runs" ("book_id", "created_at");

CREATE TABLE IF NOT EXISTS "workflow_run_steps" (
  "id"                TEXT PRIMARY KEY NOT NULL,
  "run_id"            TEXT NOT NULL,
  "step_id"           TEXT NOT NULL,
  "ordinal"           INTEGER NOT NULL,
  -- pending | running | awaiting_approval | done | skipped | failed
  "status"            TEXT NOT NULL,
  "attempt"           INTEGER NOT NULL DEFAULT 0,
  "max_attempts"      INTEGER NOT NULL,
  -- narrator | subagent | domain-tool | manual-gate
  "executor_kind"     TEXT NOT NULL,
  "agent_id"          TEXT,
  "subagent_ids_json" TEXT NOT NULL DEFAULT '[]',
  "started_at"        INTEGER,
  "finished_at"       INTEGER,
  "failure_reason"    TEXT,
  -- 最近一次打回意见或阻塞说明（三段式 explanation），进入下一次工序简报
  "explanation_json"  TEXT,
  FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_run_steps_run_step"
  ON "workflow_run_steps" ("run_id", "step_id");

-- 模型产物先落这里，永不直写权威源；批准后才按 kind 提交进既有权威源。
CREATE TABLE IF NOT EXISTS "workflow_run_candidates" (
  "id"                      TEXT PRIMARY KEY NOT NULL,
  "run_id"                  TEXT NOT NULL,
  "step_id"                 TEXT NOT NULL,
  -- scene-spec | prose | audit | other
  "kind"                    TEXT NOT NULL,
  "payload_json"            TEXT NOT NULL,
  "submitted_at"            INTEGER NOT NULL,
  "validation_json"         TEXT,
  -- pending | approved | rejected
  "decision"                TEXT NOT NULL DEFAULT 'pending',
  "decided_at"              INTEGER,
  "reviewer_note"           TEXT,
  "reviewer_selection_json" TEXT,
  "committed_ref"           TEXT,
  FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_workflow_run_candidates_step"
  ON "workflow_run_candidates" ("run_id", "step_id", "submitted_at");

-- 只追加；前端增量拉取与断线恢复依据。
CREATE TABLE IF NOT EXISTS "workflow_run_events" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "run_id"       TEXT NOT NULL,
  "seq"          INTEGER NOT NULL,
  "at"           INTEGER NOT NULL,
  "type"         TEXT NOT NULL,
  "payload_json" TEXT NOT NULL,
  FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_run_events_seq"
  ON "workflow_run_events" ("run_id", "seq");
