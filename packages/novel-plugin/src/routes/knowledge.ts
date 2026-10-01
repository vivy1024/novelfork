/**
 * 人物知情边界路由（T4.3 知情部分）：回答「第 N 章时这个角色知道什么 / 还不知道什么」。
 *
 *   GET /api/books/:bookId/narrative-memory/knowledge?entityId=&entryId=&chapter=
 *
 * - entityId（实体索引 id，`ent:<bookId>:<经纬条目 id>`）与 entryId（经纬条目 id）二选一；
 * - chapter 缺省表示「至今」；
 * - knows：截至该章他知道、且事实仍有效的记忆（来源叙事知情账，只含已确认事实）；
 * - unaware：截至该章已发生、他不在场的关键事实——写作时他还不该知道，用参与者字段反推；
 * - state：现状，每方面取该章前最后一条状态流水值。
 *
 * 空结果一律带 explanation（发生了什么 / 为什么要看 / 建议怎么做）。
 * 数据只读实体索引与知情账（entity-index.ts 整本派生的产物），不按名字匹配。
 */

import { Hono, type Context } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import {
  explainKnowledgeEmpty,
  queryEntityKnowledge,
  type EntityKnowledgeAnswer,
  type KnowledgeEmptyReason,
} from "../engine/narrative-entity/knowledge-index.js";

export interface KnowledgeRouterOptions {
  readonly storage?: StorageDatabase;
}

const BASE = "/api/books/:bookId/narrative-memory/knowledge";

function parseChapter(c: Context): number | undefined | "invalid" {
  const raw = c.req.query("chapter")?.trim();
  if (!raw || raw === "latest") return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function invalid(c: Context, summary: string): Response {
  return c.json({ error: "invalid-input", summary }, 400);
}

function emptyBody(
  answer: EntityKnowledgeAnswer,
  reason: KnowledgeEmptyReason,
  context: { chapter?: number; name?: string } = {},
) {
  return {
    ok: true,
    status: "empty" as const,
    reason,
    explanation: explainKnowledgeEmpty(reason, context),
    stats: answer.stats,
  };
}

export function createKnowledgeRouter(options: KnowledgeRouterOptions = {}): Hono {
  const app = new Hono();

  app.get(BASE, (c) => {
    const bookId = c.req.param("bookId")?.trim();
    if (!bookId) return invalid(c, "bookId 不能为空。");
    const chapter = parseChapter(c);
    if (chapter === "invalid") return invalid(c, "chapter 必须是正整数。");
    const entityId = c.req.query("entityId")?.trim();
    const entryId = c.req.query("entryId")?.trim();
    if (!entityId && !entryId) return invalid(c, "需要 entityId（实体 id）或 entryId（经纬条目 id）。");

    try {
      const storage = options.storage ?? getStorageDatabase();
      const answer = queryEntityKnowledge(storage, bookId, {
        ...(entityId ? { entityId } : {}),
        ...(entryId ? { entryId } : {}),
        ...(chapter !== undefined ? { chapter } : {}),
      });
      if (answer.schemaMissing) return c.json({ ...emptyBody(answer, "schema-missing"), ...(chapter !== undefined ? { chapter } : {}) });
      if (answer.stats.entities === 0) {
        return c.json({ ...emptyBody(answer, "index-empty"), ...(chapter !== undefined ? { chapter } : {}) });
      }
      if (!answer.entity) return c.json({ ...emptyBody(answer, "entity-not-found"), ...(chapter !== undefined ? { chapter } : {}) });
      const payload: Record<string, unknown> = {
        ok: true,
        status: "ok",
        chapter: answer.chapter,
        entity: answer.entity,
        stats: answer.stats,
        state: answer.state,
        knows: answer.knows,
        unaware: answer.unaware,
      };
      if (answer.knows.length === 0) {
        payload.notice = explainKnowledgeEmpty("no-knowledge", {
          name: answer.entity.name,
          ...(chapter !== undefined ? { chapter } : {}),
        });
      }
      return c.json(payload);
    } catch (error) {
      return c.json({
        error: "knowledge-read-failed",
        summary: "读取知情边界失败。",
        detail: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  });

  return app;
}
