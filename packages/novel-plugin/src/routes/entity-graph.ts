/**
 * 关系图谱路由（T4.4）：按实体 id 查关系，数据只来自实体索引（entity-index.ts）。
 *
 *   GET /api/books/:bookId/narrative-memory/entity-graph/entities            实体列表与索引概况
 *   GET …/entity-graph/network?focus=&hops=1|2&chapter=                     焦点人物 1–2 跳网络
 *   GET …/entity-graph/relations?entity=|entryId=&chapter=                  某实体的当前关系与关系史（实体抽屉）
 *   GET …/entity-graph/pair?a=&b=&chapter=                                  两实体的关系史、趋势与共同关系人
 *   GET …/entity-graph/path?from=&to=&chapter=                              两实体之间的最短关系路径
 *
 * chapter 缺省表示「至今」。空结果一律带 explanation（发生了什么 / 为什么要看 / 建议怎么做）。
 * 书籍归属由宿主在进入本路由前校验；这里只接受实体 id / 经纬条目 id，不按名字匹配。
 */

import { Hono, type Context } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import {
  commonRelations,
  defaultFocusEntity,
  egoNetwork,
  entityRelationSummary,
  explainGraphEmpty,
  latestGraphChapter,
  loadRelationGraphData,
  relationHistory,
  relationPath,
  relationsAtChapter,
  relationTrend,
  sharedEventCount,
  type GraphEmptyReason,
  type RelationGraphData,
} from "../engine/narrative-entity/relation-graph.js";

export interface EntityGraphRouterOptions {
  readonly storage?: StorageDatabase;
}

const BASE = "/api/books/:bookId/narrative-memory/entity-graph";

function parseChapter(c: Context): number | undefined | "invalid" {
  const raw = c.req.query("chapter")?.trim();
  if (!raw || raw === "latest") return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function invalid(c: Context, summary: string): Response {
  return c.json({ error: "invalid-input", summary }, 400);
}

function emptyBody(data: RelationGraphData, reason: GraphEmptyReason, context: { chapter?: number; name?: string } = {}) {
  return {
    ok: true,
    status: "empty" as const,
    reason,
    explanation: explainGraphEmpty(reason, { entityCount: data.entities.length, ...context }),
  };
}

/** 整本书层面的空状态：没有表 / 没有实体 / 没有关系边。都不是则返回 null。 */
function bookLevelEmpty(data: RelationGraphData) {
  if (data.schemaMissing) return emptyBody(data, "schema-missing");
  if (data.entities.length === 0) return emptyBody(data, "index-empty");
  if (data.relations.length === 0) return emptyBody(data, "no-relations");
  return null;
}

function stats(data: RelationGraphData) {
  return {
    entities: data.entities.length,
    relations: data.relations.length,
    participations: data.participations.length,
    latestChapter: latestGraphChapter(data),
  };
}

export function createEntityGraphRouter(options: EntityGraphRouterOptions = {}): Hono {
  const app = new Hono();
  const load = (bookId: string): RelationGraphData => {
    const storage = options.storage ?? getStorageDatabase();
    ensureNarrativeMemorySchema(storage);
    return loadRelationGraphData(storage, bookId);
  };
  const guarded = (handler: (c: Context, data: RelationGraphData) => Response) => (c: Context) => {
    const bookId = c.req.param("bookId")?.trim();
    if (!bookId) return invalid(c, "bookId 不能为空。");
    try {
      return handler(c, load(bookId));
    } catch (error) {
      return c.json({
        error: "entity-graph-read-failed",
        summary: "读取关系图谱失败。",
        detail: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  };

  app.get(`${BASE}/entities`, guarded((c, data) => {
    const chapter = parseChapter(c);
    if (chapter === "invalid") return invalid(c, "chapter 必须是正整数。");
    const active = relationsAtChapter(data, chapter);
    const degree = new Map<string, number>();
    for (const relation of active) {
      degree.set(relation.subjectId, (degree.get(relation.subjectId) ?? 0) + 1);
      degree.set(relation.objectId, (degree.get(relation.objectId) ?? 0) + 1);
    }
    const empty = bookLevelEmpty(data);
    return c.json({
      ok: true,
      status: empty ? "empty" : "ok",
      ...(empty ? { reason: empty.reason, explanation: empty.explanation } : {}),
      stats: stats(data),
      defaultFocusId: defaultFocusEntity(data, chapter),
      entities: data.entities.map((entity) => ({ ...entity, relationCount: degree.get(entity.id) ?? 0 })),
    });
  }));

  app.get(`${BASE}/network`, guarded((c, data) => {
    const chapter = parseChapter(c);
    if (chapter === "invalid") return invalid(c, "chapter 必须是正整数。");
    const hopsRaw = c.req.query("hops")?.trim() || "1";
    if (hopsRaw !== "1" && hopsRaw !== "2") return invalid(c, "hops 只能是 1 或 2。");
    const hops = hopsRaw === "2" ? 2 : 1;
    const empty = bookLevelEmpty(data);
    if (empty) return c.json({ ...empty, stats: stats(data) });

    const requested = c.req.query("focus")?.trim();
    if (requested && !data.entities.some((entity) => entity.id === requested)) {
      // 焦点可能在重建索引后失效（条目被删 / 同名跳过）：给说明，界面据此退回默认焦点。
      return c.json({ ...emptyBody(data, "entity-not-found"), stats: stats(data), defaultFocusId: defaultFocusEntity(data, chapter) });
    }
    const focusId = requested || defaultFocusEntity(data, chapter);
    if (!focusId) {
      return c.json({ ...emptyBody(data, "no-relations-at-chapter", chapter !== undefined ? { chapter } : {}), stats: stats(data) });
    }
    const network = egoNetwork(data, focusId, { hops, ...(chapter !== undefined ? { chapter } : {}) })!;
    const focus = network.nodes[0]!;
    return c.json({
      ok: true,
      status: "ok",
      stats: stats(data),
      network,
      ...(network.edges.length === 0
        ? { notice: explainGraphEmpty("focus-isolated", { name: focus.name, ...(chapter !== undefined ? { chapter } : {}) }) }
        : {}),
    });
  }));

  app.get(`${BASE}/relations`, guarded((c, data) => {
    const chapter = parseChapter(c);
    if (chapter === "invalid") return invalid(c, "chapter 必须是正整数。");
    const entityParam = c.req.query("entity")?.trim();
    const entryId = c.req.query("entryId")?.trim();
    if (!entityParam && !entryId) return invalid(c, "需要 entity（实体 id）或 entryId（条目 id）。");
    if (data.schemaMissing) return c.json({ ...emptyBody(data, "schema-missing"), stats: stats(data) });
    if (data.entities.length === 0) return c.json({ ...emptyBody(data, "index-empty"), stats: stats(data) });
    const entity = entityParam
      ? data.entities.find((item) => item.id === entityParam)
      : data.entities.find((item) => item.entryId === entryId);
    if (!entity) return c.json({ ...emptyBody(data, "entity-not-found"), stats: stats(data) });
    const summary = entityRelationSummary(data, entity.id, chapter)!;
    return c.json({ ok: true, status: "ok", stats: stats(data), ...summary });
  }));

  app.get(`${BASE}/pair`, guarded((c, data) => {
    const chapter = parseChapter(c);
    if (chapter === "invalid") return invalid(c, "chapter 必须是正整数。");
    const a = c.req.query("a")?.trim();
    const b = c.req.query("b")?.trim();
    if (!a || !b || a === b) return invalid(c, "需要两个不同的实体 id：a 与 b。");
    const left = data.entities.find((entity) => entity.id === a);
    const right = data.entities.find((entity) => entity.id === b);
    if (!left || !right) return c.json({ ...emptyBody(data, "entity-not-found"), stats: stats(data) }, 404);
    const history = relationHistory(data, a, b, chapter);
    return c.json({
      ok: true,
      status: "ok",
      a: left,
      b: right,
      chapter: chapter ?? null,
      history,
      trend: relationTrend(history),
      sharedEvents: sharedEventCount(data, a, b, chapter),
      common: commonRelations(data, a, b, chapter),
    });
  }));

  app.get(`${BASE}/path`, guarded((c, data) => {
    const chapter = parseChapter(c);
    if (chapter === "invalid") return invalid(c, "chapter 必须是正整数。");
    const from = c.req.query("from")?.trim();
    const to = c.req.query("to")?.trim();
    if (!from || !to) return invalid(c, "需要 from 与 to 两个实体 id。");
    if (!data.entities.some((entity) => entity.id === from) || !data.entities.some((entity) => entity.id === to)) {
      return c.json({ ...emptyBody(data, "entity-not-found"), stats: stats(data) }, 404);
    }
    const steps = relationPath(data, from, to, chapter !== undefined ? { chapter } : {});
    return c.json({
      ok: true,
      status: steps ? "ok" : "empty",
      chapter: chapter ?? null,
      steps: steps ?? [],
      ...(steps ? {} : {
        explanation: {
          whatHappened: `${chapter !== undefined ? `截至第 ${chapter} 章，` : ""}这两个实体之间 4 跳以内没有关系路径。`,
          whyItMatters: "关系路径只沿已成立的关系边走；同场出现不算关系。",
          suggestedAction: "把「截至第 N 章」往后调，或检查中间人物的关系是否已经结算进来。",
        },
      }),
    });
  }));

  return app;
}
