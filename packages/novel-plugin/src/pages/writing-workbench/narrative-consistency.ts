/**
 * 叙事体检（经纬设定 × 叙事记忆现状纰漏检测）的前端取数与分组通道。
 *
 * 后端 P4 的检测器只被写前检查当软提醒用过一次，作者看不到也处理不了。
 * 这里是体检面板的唯一取数封装：GET /consistency 结果一次性返回、不落盘
 * （诊断结果不持久化）；作者「忽略此条」的裁决由后端按忽略键记账，
 * 其余处置动作走 fact 编辑通道。
 */

import { fetchJson } from "@/hooks/use-api";

/** 与后端 DiagnosticExplanation 对齐：发生了什么 / 为什么要看 / 建议怎么做。 */
export interface FindingExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

/** 与后端 ConsistencyFinding 对齐。kind 保持开放字符串，后端加检测器时前端不必同步改。 */
export interface ConsistencyFinding {
  readonly kind: string;
  readonly severity?: "warning" | "info";
  readonly title: string;
  readonly detail?: string;
  readonly entity: string;
  readonly jingweiValue?: string;
  readonly memoryValue?: string;
  readonly jingweiEntryId?: string;
  readonly factId?: string;
  readonly memoryPredicate?: string;
  readonly memoryChapter?: number;
  readonly entityId?: string;
  /** 矛盾出现的章（场景校验）。 */
  readonly chapterNumber?: number;
  /** 正文原文句子（场景校验的证据）。 */
  readonly evidenceText?: string;
  readonly sceneLocation?: string;
  /** 后端给的忽略键，忽略 / 撤销时原样回传，前端不自己拼。 */
  readonly ignoreKey?: ConsistencyIgnoreKey;
  readonly explanation?: FindingExplanation;
}

export interface ConsistencyIgnoreKey {
  readonly kind: string;
  readonly entityId: string;
  readonly chapterNumber: number;
  readonly factId: string;
}

export interface ConsistencyReport {
  readonly bookId: string;
  readonly findings: readonly ConsistencyFinding[];
  /** 作者已忽略、本次仍检出的项（可撤销）。 */
  readonly ignored: readonly ConsistencyFinding[];
  readonly summary: string;
}

interface ConsistencyResponse {
  bookId?: string;
  findings?: ConsistencyFinding[];
  ignored?: ConsistencyFinding[];
  summary?: string;
}

/**
 * 拉取一次体检结果。
 *
 * 检测是纯读对照，失败要抛出去让面板显示错误态：静默返回空会让作者以为
 * 「没纰漏」，比看到报错更危险。
 */
export async function fetchConsistencyReport(
  bookId: string,
  options: { readonly asOfChapter?: number; readonly fetchImpl?: typeof fetch } = {},
): Promise<ConsistencyReport> {
  const query = options.asOfChapter !== undefined
    ? `?asOfChapter=${encodeURIComponent(String(options.asOfChapter))}`
    : "";
  const payload = await fetchJson<ConsistencyResponse>(
    `/api/books/${encodeURIComponent(bookId)}/narrative-memory/consistency${query}`,
    {},
    { fetchImpl: options.fetchImpl },
  );
  return {
    bookId: payload.bookId ?? bookId,
    findings: payload.findings ?? [],
    ignored: payload.ignored ?? [],
    summary: payload.summary ?? "",
  };
}

/** 持久化「忽略此条」：刷新与重新结算后都不再出现。 */
export async function ignoreConsistencyFinding(
  bookId: string,
  key: ConsistencyIgnoreKey,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<void> {
  await fetchJson(
    `/api/books/${encodeURIComponent(bookId)}/narrative-memory/consistency/ignores`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(key) },
    { fetchImpl: options.fetchImpl },
  );
}

/** 撤销忽略：这一条会重新出现在体检结果里。 */
export async function unignoreConsistencyFinding(
  bookId: string,
  key: ConsistencyIgnoreKey,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<void> {
  await fetchJson(
    `/api/books/${encodeURIComponent(bookId)}/narrative-memory/consistency/ignores/remove`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(key) },
    { fetchImpl: options.fetchImpl },
  );
}

/**
 * 稳定标识一条检出项。
 *
 * 体检结果不落盘，后端不给 finding id，React key 与「处理中」状态靠内容算。
 * 「忽略此条」不用它：忽略键由后端给（ignoreKey），裁决持久化在后端。
 */
export function findingKey(finding: ConsistencyFinding): string {
  return [
    finding.kind,
    finding.factId ?? "",
    finding.entity,
    finding.chapterNumber ?? "",
    finding.jingweiValue ?? "",
    finding.memoryValue ?? "",
  ].join("\u0000");
}

/**
 * 分组标签。
 *
 * 只用于分组标题，卡片正文一律转述后端 title/explanation。未登记的 kind
 * 原样显示 kind，不兜底成「其他问题」这类会掩盖新检测器的说法。
 */
const KIND_LABELS: Record<string, string> = {
  "realm-drift": "境界倒退 / 职级不一致",
  "orphan-location": "地点孤立",
  "scene-dead-acts": "死亡 / 离场后又行动",
  "scene-location-jump": "地点跳变无过渡",
};

export function findingKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export interface FindingGroup {
  readonly kind: string;
  readonly label: string;
  readonly findings: readonly ConsistencyFinding[];
}

/** 按 kind 分组，保持后端返回顺序（检测器顺序即严重度顺序）。 */
export function groupFindingsByKind(findings: readonly ConsistencyFinding[]): FindingGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ConsistencyFinding[]>();
  for (const finding of findings) {
    const bucket = buckets.get(finding.kind);
    if (bucket) {
      bucket.push(finding);
      continue;
    }
    order.push(finding.kind);
    buckets.set(finding.kind, [finding]);
  }
  return order.map((kind) => ({
    kind,
    label: findingKindLabel(kind),
    findings: buckets.get(kind) ?? [],
  }));
}

/**
 * 兜底解释。
 *
 * 纪律是「不得按 code 自造文案」，而不是「后端没给就留空」。旧版本后端不返回
 * explanation 时，这里给一段与 kind 无关的通用说明并转述 title/detail，作者
 * 至少知道该看什么；不按 kind 分支编造具体建议。
 */
export function explanationOf(finding: ConsistencyFinding): FindingExplanation {
  if (finding.explanation) return finding.explanation;
  return {
    whatHappened: finding.detail?.trim() || finding.title,
    whyItMatters: "经纬设定与叙事记忆现状对不上时，续写会以现状为准，设定那一边会被越写越远。",
    suggestedAction: "核对正文后决定改哪一边：现状写错就在本卡片纠正或作废，设定写错就去经纬改条目。",
  };
}
