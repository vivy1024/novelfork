/**
 * 叙事记忆 fact 的作者编辑前端通道。
 *
 * P1 落地了 fact 纠正/作废/新增的后端端点，这里是唯一的取数 + 写回封装，
 * 供叙事记忆面板与人物状态板共用，避免各组件自写 fetch 导致语义漂移。
 *
 * 编辑语义（与后端对齐）：纠正 = 关闭旧值 + 写入 manual 新值；作废 = 关闭
 * open fact（不进当前视图，历史保留）。
 */

import { fetchJson } from "@/hooks/use-api";

export interface EntityFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer?: string;
  sourceType?: string;
  confidence?: number;
  validFromChapter?: number;
  validUntilChapter?: number;
  sourceChapter?: number;
}

export interface EntityFactsGroup {
  entity: string;
  facts: EntityFact[];
}

export interface ByEntityResponse {
  groups?: EntityFactsGroup[];
  total?: number;
}

export interface FactMutationResult {
  fact?: EntityFact;
  superseded?: EntityFact;
  summary?: string;
  error?: string;
}

function memoryBase(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory`;
}

/** 按实体聚合当前 open fact（人物状态板数据源）。 */
export async function fetchFactsByEntity(
  bookId: string,
  options: { readonly asOfChapter?: number; readonly fetchImpl?: typeof fetch } = {},
): Promise<EntityFactsGroup[]> {
  const query = options.asOfChapter !== undefined ? `?asOfChapter=${encodeURIComponent(String(options.asOfChapter))}` : "";
  const payload = await fetchJson<ByEntityResponse>(`${memoryBase(bookId)}/facts/by-entity${query}`, {}, { fetchImpl: options.fetchImpl });
  return payload.groups ?? [];
}

/** 作者纠正一条 fact：关闭旧值 + 写入 manual 新值。 */
export async function correctFact(
  bookId: string,
  factId: string,
  patch: { readonly object?: string; readonly predicate?: string; readonly reason?: string },
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<FactMutationResult> {
  return fetchJson<FactMutationResult>(`${memoryBase(bookId)}/facts/${encodeURIComponent(factId)}/correct`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }, { fetchImpl: options.fetchImpl });
}

/** 作者作废一条 open fact。 */
export async function retireFact(
  bookId: string,
  factId: string,
  options: { readonly reason?: string; readonly fetchImpl?: typeof fetch } = {},
): Promise<FactMutationResult> {
  return fetchJson<FactMutationResult>(`${memoryBase(bookId)}/facts/${encodeURIComponent(factId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
  }, { fetchImpl: options.fetchImpl });
}
