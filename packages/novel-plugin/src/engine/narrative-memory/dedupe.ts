import type { NarrativeContextCard, NarrativeContextSourceType } from "./types.js";

function normalizeKeyPart(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/gu, " ").toLowerCase();
}

function factTupleKey(card: NarrativeContextCard): string | undefined {
  if (card.sourceType !== "fact") return undefined;
  const tuple = normalizeKeyPart(card.title || card.brief || card.content);
  if (!tuple) return undefined;
  // 合成当前状态时，同一 fact 语义不按 validFromChapter 拆成多份；
  // 由 preferCard 保留更新/更高分版本。
  return `fact-tuple:${card.bookId}:${tuple}`;
}

function jingweiTitleKey(card: NarrativeContextCard): string | undefined {
  if (card.sourceType !== "jingwei") return undefined;
  const title = normalizeKeyPart(card.title);
  return title ? `jingwei-title:${card.bookId}:${title}` : undefined;
}

function primaryEntity(card: NarrativeContextCard): string | undefined {
  const fromEntities = card.entities.find((entity) => entity.trim().length > 0);
  if (fromEntities) return normalizeKeyPart(fromEntities);
  const title = normalizeKeyPart(card.title);
  if (!title) return undefined;
  // 「韩立 状态 谨慎」类 fact title 取主体
  const firstToken = title.split(/[\s/:：\-—|]+/u).find(Boolean);
  return firstToken;
}

function semanticTopic(card: NarrativeContextCard): string | undefined {
  const tags = card.tags.map((tag) => normalizeKeyPart(tag)).filter(Boolean);
  const channel = card.channel;
  if (channel === "hooks" || tags.some((tag) => /hook|伏笔|foreshadow|pending-hook|线索/u.test(tag))) {
    return "hook";
  }
  if (channel === "timeline" || tags.some((tag) => /timeline|chapter-summary|previous-chapter-tail|时间线|摘要/u.test(tag))) {
    // 时间线按章节区分，不跨章合成
    const chapter = card.validFromChapter ?? card.validUntilChapter;
    return chapter === undefined ? "timeline" : `timeline-ch-${chapter}`;
  }
  if (channel === "hard" || tags.some((tag) => /canon|rule|rules|硬规则|规则|book-rules|compliance/u.test(tag))) {
    return "hard-rule";
  }
  if (channel === "style" || tags.some((tag) => /style|preset|beat|文风/u.test(tag))) {
    return undefined; // 风格条目通常不跨源强去重
  }
  if (card.sourceType === "scene-spec") return undefined;
  if (tags.some((tag) => /relationship|关系/u.test(tag))) return "relationship";
  if (tags.some((tag) => /character_state|state|状态|current/u.test(tag))) return "state";
  if (channel === "state" || channel === "facts" || channel === "relationship") {
    return channel === "relationship" ? "relationship" : "state";
  }
  return undefined;
}

/**
 * 跨源语义键：同一实体 + 同一主题只保留一份。
 * 例：韩立的当前状态，无论来自 fact / runtime-state / 经纬条目，都合成到同一 key。
 *
 * 注意：runtime 批量状态卡（多实体汇总）不做跨源语义合并，避免一条 fact 吞掉整包状态。
 */
function crossSourceSemanticKey(card: NarrativeContextCard): string | undefined {
  const topic = semanticTopic(card);
  if (!topic) return undefined;
  if (topic.startsWith("timeline-ch-") || topic === "timeline") {
    return `semantic:${card.bookId}:${topic}:${normalizeKeyPart(card.title || card.sourceId)}`;
  }
  if (topic === "hard-rule") {
    const title = normalizeKeyPart(card.title);
    return title ? `semantic:${card.bookId}:hard-rule:${title}` : undefined;
  }
  if (topic === "hook") {
    const label = normalizeKeyPart(card.title || card.brief || card.content).slice(0, 80);
    if (!label) return undefined;
    return `semantic:${card.bookId}:hook:${label}`;
  }
  // 多实体汇总卡（如 RuntimeState 当前状态事实）只做 source 级去重，不做跨源语义吞并
  if (card.sourceType === "runtime-state" && card.entities.length > 2) return undefined;
  if (card.tags.some((tag) => /current-state|runtime-timeline/u.test(normalizeKeyPart(tag))) && card.entities.length > 2) {
    return undefined;
  }
  const entity = primaryEntity(card);
  if (!entity) return undefined;
  // relationship 尽量带上客体，避免把不同关系误并
  if (topic === "relationship") {
    const objectHint = card.entities.map((item) => normalizeKeyPart(item)).filter((item) => item && item !== entity)[0]
      ?? normalizeKeyPart(card.title).replace(entity, "").trim().slice(0, 40);
    return `semantic:${card.bookId}:relationship:${entity}:${objectHint || "unknown"}`;
  }
  return `semantic:${card.bookId}:${topic}:${entity}`;
}

export function narrativeCardDedupeKeys(card: NarrativeContextCard): readonly string[] {
  return [
    `${card.sourceType}:${card.sourceId}`,
    factTupleKey(card),
    jingweiTitleKey(card),
    crossSourceSemanticKey(card),
  ].filter((key): key is string => Boolean(key));
}

/** 来源权威：动态叙事状态优先 fact/runtime，经纬作静态兜底。hard 规则另判。 */
export function sourceAuthorityRank(sourceType: NarrativeContextSourceType, channel: string): number {
  if (channel === "hard") return 1000;
  switch (sourceType) {
    case "fact":
      return 900;
    case "runtime-state":
      return 800;
    case "hook":
      return 780;
    case "scene-spec":
      return 750;
    case "chapter-summary":
      return 700;
    case "outline":
      return 650;
    case "style":
      return 400;
    case "jingwei":
      return 300;
    default:
      return 200;
  }
}

function chapterRecency(card: NarrativeContextCard): number {
  return card.validFromChapter ?? card.validUntilChapter ?? -1;
}

/**
 * 统一合成偏好：
 * 1. hard 通道优先
 * 2. 跨源权威：fact > runtime-state > hook > 经纬兜底
 * 3. 同主题取更新章节 / 更高分
 */
export function preferNarrativeCard(a: NarrativeContextCard, b: NarrativeContextCard): NarrativeContextCard {
  if (a.channel === "hard" && b.channel !== "hard") return a;
  if (b.channel === "hard" && a.channel !== "hard") return b;

  const aAuth = sourceAuthorityRank(a.sourceType, a.channel);
  const bAuth = sourceAuthorityRank(b.sourceType, b.channel);
  if (aAuth !== bAuth) return aAuth > bAuth ? a : b;

  const aChapter = chapterRecency(a);
  const bChapter = chapterRecency(b);
  if (aChapter !== bChapter) return aChapter > bChapter ? a : b;

  const aScore = a.score ?? 0;
  const bScore = b.score ?? 0;
  if (aScore !== bScore) return aScore > bScore ? a : b;
  if (a.priority !== b.priority) return a.priority > b.priority ? a : b;
  if (a.importance !== b.importance) return a.importance > b.importance ? a : b;
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

function uniqueReasons(cards: readonly NarrativeContextCard[]): string {
  const reasons = cards.map((card) => card.reason.trim()).filter(Boolean);
  return [...new Set(reasons)].join("；");
}

export function mergeDuplicateCardReasons(card: NarrativeContextCard, duplicates: readonly NarrativeContextCard[]): NarrativeContextCard {
  if (duplicates.length === 0) return card;
  const reason = uniqueReasons([card, ...duplicates]);
  const suppressed = duplicates
    .map((item) => `${item.sourceType}:${item.sourceId}`)
    .filter(Boolean);
  const synthesisNote = suppressed.length > 0
    ? `已统一合成，覆盖次级来源：${[...new Set(suppressed)].join("、")}`
    : "";
  const mergedReason = [reason, synthesisNote].filter(Boolean).join("；");
  const authorityBoost = sourceAuthorityRank(card.sourceType, card.channel);
  return {
    ...card,
    reason: mergedReason || card.reason,
    scoreBreakdown: {
      ...(card.scoreBreakdown ?? {}),
      authorityBoost,
      suppressedSources: suppressed.length,
    },
  };
}
