/**
 * 叙事线快照与 proposal 审批的 HTTP 面。
 *
 * 纪律：
 * - bookId 只从已过 ACL 的路径参数取；书籍根由宿主注入的 resolveBookRoot 解析，
 *   前端和模型都不得传路径。
 * - propose 只计算预览，不落盘；apply 才写 story/narrative_line.json，
 *   且批准与驳回都会进审批台账。
 * - 拦截与告警一律带 explanation（发生了什么 / 为什么要看 / 建议怎么做），
 *   前端不得按 code 自造文案。
 */

import { Hono } from "hono";

import { StateManager, type ChapterMeta } from "@vivy1024/novelfork-core";

import {
  createNarrativeLineService,
  type NarrativeLineState,
} from "../handlers/narrative-line-service.js";
import { createResourceCheckpointService } from "../handlers/resource-checkpoint-service.js";
import type { NarrativeLineMutationPreview } from "../handlers/narrative-line-types.js";

export interface CreateNarrativeLineRouterOptions {
  /** 解析可信书籍根目录（由 Product Runtime 的绑定提供）。 */
  readonly resolveBookRoot: (bookId: string) => string;
  /** 注入用；缺省按 bookRoot 构造只读章节索引读取器。 */
  readonly state?: NarrativeLineState;
  readonly now?: () => Date;
}

const MAX_SUMMARY_LENGTH = 2_000;
const MAX_REASON_LENGTH = 2_000;
const MAX_COLLECTION_SIZE = 500;

function stateFor(options: CreateNarrativeLineRouterOptions, bookId: string): NarrativeLineState {
  if (options.state) return options.state;
  const bookRoot = options.resolveBookRoot(bookId);
  // StateManager 需要一个项目根用于少数项目级路径；书籍目录只由可信绑定决定。
  const manager = new StateManager(bookRoot, {
    resolveBookDir: (requestedBookId) => {
      if (requestedBookId !== bookId) {
        throw new Error("The requested book does not match the trusted narrative-line binding.");
      }
      return bookRoot;
    },
  });
  return {
    loadChapterIndex: (id: string): Promise<ReadonlyArray<ChapterMeta>> => manager.loadChapterIndex(id),
    bookDir: (id: string): string => manager.bookDir(id),
  };
}

function serviceFor(options: CreateNarrativeLineRouterOptions, bookId: string) {
  const state = stateFor(options, bookId);
  return createNarrativeLineService({
    state,
    ...(options.now ? { now: options.now } : {}),
    checkpoint: createResourceCheckpointService({ bookDir: (id: string) => state.bookDir(id) }),
  });
}

function asCollection(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_COLLECTION_SIZE) : [];
}

function asBoundedText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : undefined;
}

/**
 * 校验 apply 请求里的 preview。
 *
 * preview 由 propose 生成，但 HTTP 是无状态的，客户端可以改写它再提交。
 * 这里不信任 bookId 与结构：bookId 一律用路径参数覆盖，其余字段做形状校验。
 */
function parsePreview(value: unknown, bookId: string): NarrativeLineMutationPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = asBoundedText(record.summary, MAX_SUMMARY_LENGTH);
  if (!summary) return null;
  const id = asBoundedText(record.id, 200) ?? `narrative-preview:${bookId}:unknown`;
  return {
    id,
    bookId,
    summary,
    nodes: asCollection(record.nodes) as NarrativeLineMutationPreview["nodes"],
    edges: asCollection(record.edges) as NarrativeLineMutationPreview["edges"],
    removeNodeIds: asCollection(record.removeNodeIds).filter((item): item is string => typeof item === "string"),
    removeEdgeIds: asCollection(record.removeEdgeIds).filter((item): item is string => typeof item === "string"),
    warnings: [],
  };
}

export function createNarrativeLineRouter(options: CreateNarrativeLineRouterOptions): Hono {
  const app = new Hono();
  const base = "/api/books/:bookId/narrative-line";

  app.get(base, async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const snapshot = await serviceFor(options, bookId).getSnapshot({
        bookId,
        includeWarnings: c.req.query("includeWarnings") !== "false",
      });
      return c.json({ snapshot });
    } catch (error) {
      return c.json({
        error: "narrative-line-read-failed",
        explanation: `读取叙事线快照失败：${error instanceof Error ? error.message : String(error)}。请确认这本书的绑定与 story 目录可访问。`,
      }, 500);
    }
  });

  app.get(`${base}/approvals`, async (c) => {
    const bookId = c.req.param("bookId");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
      return c.json({
        error: "invalid-query",
        explanation: "limit 必须是 1 到 500 的整数；请去掉该参数或改成合法范围。",
      }, 400);
    }
    try {
      const approvals = await serviceFor(options, bookId).listApprovals({
        bookId,
        ...(limit !== undefined ? { limit } : {}),
      });
      return c.json({ approvals });
    } catch (error) {
      return c.json({
        error: "narrative-line-approvals-failed",
        explanation: `读取叙事线审批台账失败：${error instanceof Error ? error.message : String(error)}。`,
      }, 500);
    }
  });

  app.post(`${base}/propose`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const summary = asBoundedText(body.summary, MAX_SUMMARY_LENGTH);
    if (!summary) {
      return c.json({
        error: "invalid-input",
        explanation: "summary 必须是非空字符串：它是作者在审批台账里识别这条提议的唯一说明。",
      }, 400);
    }
    try {
      const preview = await serviceFor(options, bookId).proposeChange({
        bookId,
        summary,
        nodes: asCollection(body.nodes),
        edges: asCollection(body.edges),
        removeNodeIds: asCollection(body.removeNodeIds),
        removeEdgeIds: asCollection(body.removeEdgeIds),
        ...(asBoundedText(body.reason, MAX_REASON_LENGTH) ? { reason: asBoundedText(body.reason, MAX_REASON_LENGTH)! } : {}),
      });
      return c.json({ preview });
    } catch (error) {
      return c.json({
        error: "narrative-line-propose-failed",
        explanation: `生成叙事线变更预览失败：${error instanceof Error ? error.message : String(error)}。预览不会写入任何文件，可修正输入后重试。`,
      }, 500);
    }
  });

  app.post(`${base}/apply`, async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
    if (!decision) {
      return c.json({
        error: "invalid-input",
        explanation: "decision 必须是 approved 或 rejected：这是作者的显式审批结论，不能省略。",
      }, 400);
    }
    const preview = parsePreview(body.preview, bookId);
    if (!preview) {
      return c.json({
        error: "invalid-preview",
        explanation: "preview 必须是 propose 返回的对象且带非空 summary。请先调用 propose 获取预览，再连同审批结论提交。",
      }, 400);
    }
    try {
      const result = await serviceFor(options, bookId).applyChange({
        bookId,
        preview,
        decision,
        ...(asBoundedText(body.sessionId, 200) ? { sessionId: asBoundedText(body.sessionId, 200)! } : {}),
        ...(asBoundedText(body.confirmationId, 200) ? { confirmationId: asBoundedText(body.confirmationId, 200)! } : {}),
        ...(asBoundedText(body.reason, MAX_REASON_LENGTH) ? { reason: asBoundedText(body.reason, MAX_REASON_LENGTH)! } : {}),
      });
      return c.json(result);
    } catch (error) {
      return c.json({
        error: "narrative-line-apply-failed",
        explanation: `应用叙事线变更失败：${error instanceof Error ? error.message : String(error)}。story/narrative_line.json 未被部分写入。`,
      }, 500);
    }
  });

  return app;
}
