/**
 * 叙事记忆 fact 的作者编辑前端通道。
 *
 * P1 落地了 fact 纠正/作废/新增的后端端点，这里是唯一的取数 + 写回封装，
 * 供叙事记忆面板、人物状态板与叙事体检面板共用，避免各组件自写 fetch 导致
 * 语义漂移。
 *
 * 编辑语义（与后端对齐）：
 * - 纠正 = 关闭旧值 + 写入 manual 新值（可同时改 predicate/category，抽错
 *   谓词时不必先作废再新增）；
 * - 作废 = 关闭 open fact（不进当前视图，历史保留）；
 * - 新增 = 写入一条 manual fact，后端默认关闭同 slot 被顶替的旧值。
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

/**
 * 按实体聚合当前 open fact。
 *
 * 不传 entity 时维持人物状态板的「按主体分组」视图；传 entity 时，后端同时匹配
 * subject / object，供实体详情抽屉查看关系两端的完整动态状态。
 */
export async function fetchFactsByEntity(
  bookId: string,
  options: { readonly asOfChapter?: number; readonly entity?: string; readonly fetchImpl?: typeof fetch } = {},
): Promise<EntityFactsGroup[]> {
  const queryParts: string[] = [];
  if (options.asOfChapter !== undefined) queryParts.push(`asOfChapter=${encodeURIComponent(String(options.asOfChapter))}`);
  if (options.entity?.trim()) queryParts.push(`entity=${encodeURIComponent(options.entity.trim())}`);
  const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
  const payload = await fetchJson<ByEntityResponse>(`${memoryBase(bookId)}/facts/by-entity${query}`, {}, { fetchImpl: options.fetchImpl });
  return payload.groups ?? [];
}

/**
 * 纠正补丁。字段与后端 correctNarrativeFact 一一对应。
 *
 * predicate/category 也开放：机器抽取常把「修为」抽成「实力」或把 category
 * 归错，只能改 object 的话作者得先作废再手工新增，中间那条历史就断了。
 */
export interface FactCorrectionPatch {
  /** 改主体同样走替代语义：关闭原实体下的旧值，再写入目标实体的 manual 新值。 */
  readonly subject?: string;
  readonly object?: string;
  readonly predicate?: string;
  readonly category?: string;
  readonly confidence?: number;
  readonly evidenceText?: string;
  readonly reason?: string;
}

/** 作者手动新增一条 fact 的输入。layer 由后端固定为 dynamic，前端不得指定。 */
export interface FactCreateInput {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: string;
  readonly confidence?: number;
  readonly evidenceText?: string;
  readonly validFromChapter?: number;
  /** false 时保留同 slot 旧值不关闭；默认交给后端（关闭被顶替的旧值）。 */
  readonly closeSuperseded?: boolean;
}

/** 去掉 undefined 字段，避免把 `{"object":undefined}` 序列化成缺字段的空补丁语义。 */
function compact(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

/** 作者纠正一条 fact：关闭旧值 + 写入 manual 新值。 */
export async function correctFact(
  bookId: string,
  factId: string,
  patch: FactCorrectionPatch,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<FactMutationResult> {
  return fetchJson<FactMutationResult>(`${memoryBase(bookId)}/facts/${encodeURIComponent(factId)}/correct`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(compact({ ...patch })),
  }, { fetchImpl: options.fetchImpl });
}

/**
 * 作者手动新增一条 fact（sourceType=manual，享有结算覆盖保护）。
 *
 * 用于机器把 subject 抽错这类「纠正救不回来」的情况：作废错的那条，再补一条
 * 正确的。也是实体详情抽屉「手工补一条状态」的通道。
 */
export async function createFact(
  bookId: string,
  input: FactCreateInput,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<FactMutationResult> {
  return fetchJson<FactMutationResult>(`${memoryBase(bookId)}/facts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(compact({
      subject: input.subject.trim(),
      predicate: input.predicate.trim(),
      object: input.object.trim(),
      category: input.category.trim(),
      confidence: input.confidence,
      evidenceText: input.evidenceText,
      validFromChapter: input.validFromChapter,
      closeSuperseded: input.closeSuperseded,
    })),
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
