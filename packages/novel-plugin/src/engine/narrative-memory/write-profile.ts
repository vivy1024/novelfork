import type { ChapterStateProjection, DerivedCharacterState, DerivedCommitment, DerivedHook } from "@vivy1024/novelfork-core";

import type { PackedNarrativeContextCard } from "./budget.js";
import type { NarrativeContextCard, NarrativeRetrievalDiagnostics } from "./types.js";

export const DEFAULT_WRITE_PROFILE_CAPS = {
  coreCharacters: 6,
  activeHooks: 8,
  recentSummaries: 3,
} as const;

export type WriteProfileCapKind = keyof typeof DEFAULT_WRITE_PROFILE_CAPS;

export interface WriteProfileCaps {
  readonly coreCharacters: number;
  readonly activeHooks: number;
  readonly recentSummaries: number;
}

export interface WriteProfileTrimReason {
  readonly id: string;
  readonly reason: string;
  readonly channel?: string;
  readonly kind: "count-cap" | "token-budget" | "aged" | "degraded" | "named-keep";
}

export interface WriteProfileItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly chapter?: number;
  readonly named?: boolean;
}

export interface WriteProfileColumn {
  readonly key: string;
  readonly title: string;
  readonly items: readonly WriteProfileItem[];
  readonly candidateCount: number;
  readonly trimmed: number;
  readonly cap?: number;
}

export interface WriteProfile {
  readonly locationAndTime: WriteProfileColumn;
  readonly hardConstraints: WriteProfileColumn;
  readonly coreCharacters: WriteProfileColumn;
  readonly activeHooks: WriteProfileColumn;
  readonly recentSummaries: WriteProfileColumn;
  readonly nextCommitments: WriteProfileColumn;
  readonly continuityRisks: WriteProfileColumn;
  readonly caps: WriteProfileCaps;
  readonly namedEntities: readonly string[];
  readonly trimReasons: readonly WriteProfileTrimReason[];
}

export interface BuildWriteProfileInput {
  readonly projection: ChapterStateProjection;
  readonly cards?: readonly PackedNarrativeContextCard[] | readonly NarrativeContextCard[];
  readonly diagnostics?: Pick<NarrativeRetrievalDiagnostics, "warnings" | "droppedCardIds" | "degradedCards">;
  readonly namedEntities?: readonly string[];
  readonly caps?: Partial<WriteProfileCaps>;
  readonly currentChapter?: number;
}

function uniqueStrings(values: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function asCards(cards: BuildWriteProfileInput["cards"]): NarrativeContextCard[] {
  if (!cards) return [];
  return cards.map((item) => ("card" in item ? item.card : item));
}

function matchesNamed(text: string, named: readonly string[]): boolean {
  return named.some((entity) => entity && text.includes(entity));
}

function characterMatches(character: DerivedCharacterState, named: readonly string[]): boolean {
  return matchesNamed(`${character.characterId} ${character.name ?? ""}`, named);
}

function hookMatches(hook: DerivedHook, named: readonly string[]): boolean {
  return matchesNamed(`${hook.hookId} ${hook.expectedPayoff} ${hook.notes}`, named);
}

function capColumn<T>(
  items: readonly T[],
  cap: number,
  namedKeep: (item: T) => boolean,
): { kept: T[]; trimmed: T[] } {
  if (cap <= 0 || items.length <= cap) return { kept: [...items], trimmed: [] };
  const named = items.filter(namedKeep);
  const unnamed = items.filter((item) => !namedKeep(item));
  const keptNamed = named.slice(0, Math.max(cap, named.length));
  const remaining = Math.max(0, cap - keptNamed.length);
  const keptUnnamed = unnamed.slice(0, remaining);
  const trimmed = [...named.slice(keptNamed.length), ...unnamed.slice(keptUnnamed.length)];
  return { kept: [...keptNamed, ...keptUnnamed], trimmed };
}

function column(
  key: string,
  title: string,
  items: readonly WriteProfileItem[],
  candidateCount = items.length,
  cap?: number,
): WriteProfileColumn {
  return {
    key,
    title,
    items,
    candidateCount,
    trimmed: Math.max(0, candidateCount - items.length),
    ...(typeof cap === "number" ? { cap } : {}),
  };
}

function characterItem(character: DerivedCharacterState, named: boolean): WriteProfileItem {
  return {
    id: `character:${character.characterId}`,
    title: character.name ?? character.characterId,
    summary: [character.currentState, character.currentGoal, character.arcProgress].filter(Boolean).join("；")
      || character.characterId,
    chapter: character.lastChapter,
    named,
  };
}

function hookItem(hook: DerivedHook, named: boolean): WriteProfileItem {
  return {
    id: `hook:${hook.hookId}`,
    title: hook.expectedPayoff || hook.notes || hook.hookId,
    summary: `${hook.status} · 第${hook.startChapter}章起，最近第${hook.lastAdvancedChapter}章`,
    chapter: hook.lastAdvancedChapter,
    named,
  };
}

function commitmentItem(commitment: DerivedCommitment): WriteProfileItem {
  return {
    id: `commitment:${commitment.id}`,
    title: commitment.text,
    summary: commitment.targetChapter ? `目标第${commitment.targetChapter}章` : commitment.scope,
    chapter: commitment.targetChapter ?? commitment.sourceChapter,
  };
}

export function recentSummaryColumnTitle(cap: number): string {
  return cap === 3 ? "近三章速记" : `近${cap}章速记`;
}

/**
 * 七栏写前热上下文。角色/伏笔/近章上限可配，默认 6/8/3，不是硬截断：
 * scene.spec / memory.read 点名的实体始终保留，即使超过上限。
 */
export function buildWriteProfile(input: BuildWriteProfileInput): WriteProfile {
  const caps: WriteProfileCaps = {
    coreCharacters: input.caps?.coreCharacters ?? DEFAULT_WRITE_PROFILE_CAPS.coreCharacters,
    activeHooks: input.caps?.activeHooks ?? DEFAULT_WRITE_PROFILE_CAPS.activeHooks,
    recentSummaries: input.caps?.recentSummaries ?? DEFAULT_WRITE_PROFILE_CAPS.recentSummaries,
  };
  const namedEntities = uniqueStrings(input.namedEntities ?? []);
  const cards = asCards(input.cards);
  const projection = input.projection;
  const trimReasons: WriteProfileTrimReason[] = [];

  const lastTimeline = [...projection.timeline].sort((left, right) => right.chapter - left.chapter)[0];
  const locationCard = cards.find((card) => card.channel === "timeline" || /地点|位置|location/u.test(card.title));
  const locationAndTime = column("locationAndTime", "当前位置与故事时间", [
    {
      id: lastTimeline ? `timeline:${lastTimeline.chapter}` : "timeline:none",
      title: lastTimeline?.label || lastTimeline?.storyTime || locationCard?.title || "故事时间未记录",
      summary: [
        lastTimeline?.storyTime,
        lastTimeline?.label,
        lastTimeline ? `第${lastTimeline.chapter}章` : undefined,
        locationCard?.brief ?? locationCard?.content,
      ].filter(Boolean).join(" · ") || "尚无时间线 Delta。",
      chapter: lastTimeline?.chapter ?? locationCard?.validFromChapter,
    },
  ]);

  const hardCards = cards.filter((card) => card.channel === "hard");
  const hardConstraints = column("hardConstraints", "硬约束", hardCards.map((card) => ({
    id: card.id,
    title: card.title,
    summary: card.brief || card.content.slice(0, 180),
  })));

  const characterCandidates = [...projection.characters].sort((left, right) => (
    right.lastChapter - left.lastChapter || left.characterId.localeCompare(right.characterId)
  ));
  const characterCap = capColumn(characterCandidates, caps.coreCharacters, (item) => characterMatches(item, namedEntities));
  for (const character of characterCap.trimmed) {
    trimReasons.push({
      id: `character:${character.characterId}`,
      reason: namedEntities.length > 0 && characterMatches(character, namedEntities)
        ? "超过核心角色上限，但因点名实体保留失败后被记下。"
        : `核心角色超过上限 ${caps.coreCharacters}，按最近出场裁剪。`,
      channel: "state",
      kind: "count-cap",
    });
  }
  for (const character of characterCap.kept.filter((item) => characterMatches(item, namedEntities) && characterCandidates.length > caps.coreCharacters)) {
    trimReasons.push({
      id: `character:${character.characterId}`,
      reason: `点名实体「${character.name ?? character.characterId}」超过核心角色上限，仍保留。`,
      channel: "state",
      kind: "named-keep",
    });
  }
  const coreCharacters = column(
    "coreCharacters",
    "核心角色",
    characterCap.kept.map((character) => characterItem(character, characterMatches(character, namedEntities))),
    characterCandidates.length,
    caps.coreCharacters,
  );

  const hookCandidates = projection.hooks
    .filter((hook) => hook.status !== "resolved")
    .sort((left, right) => (
      (left.status === "progressing" ? 0 : 1) - (right.status === "progressing" ? 0 : 1)
      || right.lastAdvancedChapter - left.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    ));
  const hookCap = capColumn(hookCandidates, caps.activeHooks, (item) => hookMatches(item, namedEntities));
  for (const hook of hookCap.trimmed) {
    trimReasons.push({
      id: `hook:${hook.hookId}`,
      reason: `活跃伏笔超过上限 ${caps.activeHooks}，按最近推进裁剪。`,
      channel: "hooks",
      kind: "count-cap",
    });
  }
  for (const hook of hookCap.kept.filter((item) => hookMatches(item, namedEntities) && hookCandidates.length > caps.activeHooks)) {
    trimReasons.push({
      id: `hook:${hook.hookId}`,
      reason: `点名伏笔「${hook.hookId}」超过上限，仍保留。`,
      channel: "hooks",
      kind: "named-keep",
    });
  }
  const activeHooks = column(
    "activeHooks",
    "活跃伏笔",
    hookCap.kept.map((hook) => hookItem(hook, hookMatches(hook, namedEntities))),
    hookCandidates.length,
    caps.activeHooks,
  );

  const summaryCandidates = [...projection.summaries]
    .filter((row) => input.currentChapter === undefined || row.chapter < input.currentChapter)
    .sort((left, right) => right.chapter - left.chapter);
  const summaryCap = capColumn(summaryCandidates, caps.recentSummaries, (row) => matchesNamed(`${row.title} ${row.characters} ${row.events}`, namedEntities));
  for (const row of summaryCap.trimmed) {
    trimReasons.push({
      id: `summary:${row.chapter}`,
      reason: `近章速记超过上限 ${caps.recentSummaries}，只保留最近 ${caps.recentSummaries} 章。`,
      channel: "recent-summary",
      kind: "count-cap",
    });
  }
  const recentSummaries = column(
    "recentSummaries",
    recentSummaryColumnTitle(caps.recentSummaries),
    summaryCap.kept.map((row) => ({
      id: `summary:${row.chapter}`,
      title: `第${row.chapter}章 ${row.title}`,
      summary: [row.events, row.stateChanges, row.hookActivity].filter(Boolean).join("；"),
      chapter: row.chapter,
    })),
    summaryCandidates.length,
    caps.recentSummaries,
  );

  const nextCommitments = column(
    "nextCommitments",
    "下一章承诺",
    projection.commitments
      .filter((item) => !item.fulfilled)
      .map(commitmentItem),
  );

  const riskItems: WriteProfileItem[] = [];
  for (const hook of projection.hooks.filter((item) => item.status !== "resolved")) {
    const gap = (input.currentChapter ?? projection.lastChapter) - hook.lastAdvancedChapter;
    if (gap >= 8) {
      riskItems.push({
        id: `risk-hook:${hook.hookId}`,
        title: `伏笔过期：${hook.expectedPayoff || hook.hookId}`,
        summary: `已 ${gap} 章未推进。`,
        chapter: hook.lastAdvancedChapter,
      });
    }
  }
  for (const warning of input.diagnostics?.warnings ?? []) {
    riskItems.push({
      id: `risk-warning:${warning.slice(0, 24)}`,
      title: "召回告警",
      summary: warning,
    });
  }
  const continuityRisks = column("continuityRisks", "连贯性风险", riskItems);

  for (const cardId of input.diagnostics?.droppedCardIds ?? []) {
    trimReasons.push({
      id: cardId,
      reason: "token 预算不足，卡片被丢弃。",
      kind: "token-budget",
    });
  }
  for (const item of input.diagnostics?.degradedCards ?? []) {
    trimReasons.push({
      id: item.id,
      reason: `token 预算不足，从 ${item.from} 降到 ${item.to}。`,
      kind: "degraded",
    });
  }

  return {
    locationAndTime,
    hardConstraints,
    coreCharacters,
    activeHooks,
    recentSummaries,
    nextCommitments,
    continuityRisks,
    caps,
    namedEntities,
    trimReasons,
  };
}

export function writeProfileKeepIds(profile: WriteProfile): Set<string> {
  return new Set([
    ...profile.coreCharacters.items.map((item) => item.id.replace(/^character:/u, "")),
    ...profile.activeHooks.items.map((item) => item.id.replace(/^hook:/u, "")),
    ...profile.recentSummaries.items.map((item) => item.id),
  ]);
}

function cardTouchesNamed(card: NarrativeContextCard, named: readonly string[]): boolean {
  if (named.length === 0) return false;
  const haystack = [card.title, card.content, card.brief, ...card.entities, ...card.tags].join("\n");
  return named.some((entity) => entity && haystack.includes(entity));
}

/**
 * 条目上限裁剪：按 write profile caps。点名实体卡片始终保留，即使超过上限。
 */
export function applyWriteProfileCountCaps(
  cards: readonly NarrativeContextCard[],
  profile: WriteProfile,
): { cards: NarrativeContextCard[]; trimReasons: WriteProfileTrimReason[] } {
  const named = profile.namedEntities;
  const keepCharacterIds = new Set(profile.coreCharacters.items.map((item) => item.id.replace(/^character:/u, "")));
  const keepHookIds = new Set(profile.activeHooks.items.map((item) => item.id.replace(/^hook:/u, "")));
  const keepSummaryChapters = new Set(profile.recentSummaries.items.map((item) => item.chapter).filter((value): value is number => typeof value === "number"));
  const trimReasons: WriteProfileTrimReason[] = [];
  const kept: NarrativeContextCard[] = [];

  const stateCards = cards.filter((card) => card.channel === "state" || card.channel === "character-kernel");
  const hookCards = cards.filter((card) => card.channel === "hooks");
  const summaryCards = cards.filter((card) => card.channel === "recent-summary");
  const passthrough = cards.filter((card) => (
    card.channel !== "state"
    && card.channel !== "character-kernel"
    && card.channel !== "hooks"
    && card.channel !== "recent-summary"
  ));

  const keepState = capCards(stateCards, profile.caps.coreCharacters, named, (card) => (
    cardTouchesNamed(card, [...keepCharacterIds])
  ));
  const keepHooks = capCards(hookCards, profile.caps.activeHooks, named, (card) => (
    cardTouchesNamed(card, [...keepHookIds])
  ));
  const keepSummaries = capCards(summaryCards, profile.caps.recentSummaries, named, (card) => (
    typeof card.validFromChapter === "number" && keepSummaryChapters.has(card.validFromChapter)
  ));

  for (const card of keepState.trimmed) {
    trimReasons.push({ id: card.id, reason: `核心角色超过上限 ${profile.caps.coreCharacters}。`, channel: card.channel, kind: "count-cap" });
  }
  for (const card of keepHooks.trimmed) {
    trimReasons.push({ id: card.id, reason: `活跃伏笔超过上限 ${profile.caps.activeHooks}。`, channel: card.channel, kind: "count-cap" });
  }
  for (const card of keepSummaries.trimmed) {
    trimReasons.push({ id: card.id, reason: `近章速记超过上限 ${profile.caps.recentSummaries}。`, channel: card.channel, kind: "count-cap" });
  }

  kept.push(...passthrough, ...keepState.kept, ...keepHooks.kept, ...keepSummaries.kept);
  return { cards: kept, trimReasons };
}

function capCards(
  cards: readonly NarrativeContextCard[],
  cap: number,
  named: readonly string[],
  inProfile: (card: NarrativeContextCard) => boolean,
): { kept: NarrativeContextCard[]; trimmed: NarrativeContextCard[] } {
  const namedCards = cards.filter((card) => cardTouchesNamed(card, named) || inProfile(card));
  const rest = cards.filter((card) => !namedCards.includes(card));
  if (cards.length <= cap) return { kept: [...cards], trimmed: [] };
  const keptNamed = namedCards;
  const remaining = Math.max(0, cap - keptNamed.length);
  const keptRest = rest.slice(0, remaining);
  return {
    kept: [...keptNamed, ...keptRest],
    trimmed: rest.slice(remaining),
  };
}
