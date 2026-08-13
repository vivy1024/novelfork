/**
 * 叙事体检（经纬设定 × 叙事记忆现状纰漏检测）的前端取数与分组通道。
 *
 * 后端 P4 的检测器只被写前检查当软提醒用过一次，作者看不到也处理不了。
 * 这里是体检面板的唯一取数封装：只读 GET /consistency，结果一次性返回、
 * 不落盘（诊断结果不持久化），面板里的处置动作全部走 fact 编辑通道。
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
  readonly explanation?: FindingExplanation;
}

export interface ConsistencyReport {
  readonly bookId: string;
  readonly findings: readonly ConsistencyFinding[];
  readonly summary: string;
}

interface ConsistencyResponse {
  bookId?: string;
  findings?: ConsistencyFinding[];
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
    summary: payload.summary ?? "",
  };
}

/**
 * 稳定标识一条检出项。
 *
 * 体检结果不落盘，后端不给 finding id，「已忽略」只能靠内容算 key。用
 * kind + 事实 id + 两边取值组合：同一条纰漏重新检测后 key 不变，作者纠正
 * 或作废之后（值变了）不会被旧的忽略状态藏起来。
 */
export function findingKey(finding: ConsistencyFinding): string {
  return [
    finding.kind,
    finding.factId ?? "",
    finding.entity,
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
