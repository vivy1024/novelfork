/**
 * 资料索引卡（T4.7）：一小张随每趟对话重注入的「资料地图」。
 *
 * 会话压缩只折叠历史消息，prompt 扩展每趟重建——索引卡跟着简报走同一条路，
 * 天然绕过压缩。它钉住的不是资料本体（权威源在库，永远可取活本），
 * 而是「上次注入用了哪些资料、去哪里重取原文」这几百 token 的指针：
 * 模型案头只剩摘要版时，按卡上的通道名重取，别凭摘要猜。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { getLatestNarrativeRetrievalLog } from "./storage.js";

/** 日志里复述卡号用的前缀长度：取 id 末段（生产 id 形如 `narrative-retrieval:<bookId>:<uuid>`）。 */
const LOG_ID_PREFIX = 8;

function logTagOf(logId: string): string {
  const tail = logId.includes(":") ? (logId.split(":").pop() ?? logId) : logId;
  return tail.slice(0, LOG_ID_PREFIX);
}

const RECALL_CHANNELS: readonly { readonly need: string; readonly channels: readonly string[] }[] = [
  { need: "范文 / 声线 / 文风边界", channels: ["style"] },
  { need: "角色此刻状态与「他不知道什么」", channels: ["state", "knowledge"] },
  { need: "该推哪条伏笔、哪些到期", channels: ["hooks"] },
  { need: "章摘要 / 时间线 / 因果与关系", channels: ["recent-summary", "timeline", "relationship"] },
];

export interface ContextIndexCardSummary {
  readonly chapterNumber: number | undefined;
  readonly logId: string;
  readonly tokensByChannel: Readonly<Record<string, number>>;
  readonly degradedCount: number;
  readonly droppedCount: number;
  readonly trimReasonCount: number;
  readonly purpose: string;
}

/** 读取最近一条「写作向」召回日志（write_chapter/revise）并折算成卡片要素；没有写作历史返回 null。 */
export function summarizeContextIndexCard(
  storage: StorageDatabase,
  bookId: string,
): ContextIndexCardSummary | null {
  // outline/audit 召回也落同一张日志表，但它们不是「写作注入」，混进来会把重取指向带偏。
  const log = getLatestNarrativeRetrievalLog(storage, bookId, ["write_chapter", "revise"]);
  if (!log) return null;
  const diagnostics = log.diagnostics;
  const injected = diagnostics.injectedTokensByChannel ?? {};
  // 只列真的进了上下文的通道：注入 0 的通道报了反而误导。
  const tokensByChannel: Record<string, number> = {};
  for (const stat of diagnostics.channelStats) {
    const tokens = injected[stat.channel] ?? 0;
    if (tokens > 0) tokensByChannel[stat.channel] = tokens;
  }
  return {
    chapterNumber: log.chapterNumber,
    logId: log.id,
    tokensByChannel,
    degradedCount: diagnostics.degradedCards.length,
    droppedCount: diagnostics.droppedCardIds.length,
    trimReasonCount: diagnostics.trimReasons?.length ?? 0,
    purpose: log.purpose,
  };
}

/** 渲染成注入给模型的卡片文本。 */
export function renderContextIndexCard(summary: ContextIndexCardSummary): string {
  const chapter = summary.chapterNumber ? `第 ${summary.chapterNumber} 章` : "未标章";
  const logTag = logTagOf(summary.logId);
  const channels = Object.entries(summary.tokensByChannel)
    .map(([channel, tokens]) => `${channel} ${tokens}`)
    .join(" / ");
  const trims = summary.degradedCount + summary.droppedCount + summary.trimReasonCount;
  const usage = trims > 0
    ? `，降档 ${summary.degradedCount}、整段裁剪 ${summary.droppedCount}、预算/条数剪裁 ${summary.trimReasonCount}（见「写作可见」报告）`
    : "，无降档与裁剪";
  const lines = [
    "【资料索引卡 · 原文皆在库可重取】",
    `上次写作注入（${chapter}，日志 ${logTag}）：${channels || "（未注入任何通道）"}${usage}。`,
    "案头资料若已被会话压缩成摘要版，按通道重取原文，别凭摘要猜：",
    ...RECALL_CHANNELS.map((line) => `- ${line.need} → memory_read(channels=[${line.channels.map((c) => `"${c}"`).join(",")}])`),
    "- 经纬设定原文 → lore_read；章节正文 → chapter_read",
  ];
  return lines.join("\n");
}

/** 一步生成卡片文本；没有写作历史返回 null（不注入）。 */
export function buildContextIndexCard(storage: StorageDatabase, bookId: string): string | null {
  const summary = summarizeContextIndexCard(storage, bookId);
  return summary ? renderContextIndexCard(summary) : null;
}
