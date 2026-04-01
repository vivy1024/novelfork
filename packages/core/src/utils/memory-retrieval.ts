import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HookAgenda, HookPressure } from "../models/input-governance.js";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  type HookRecord,
  type HookStatus,
} from "../models/runtime-state.js";
import { MemoryDB, type Fact, type StoredHook, type StoredSummary } from "../state/memory-db.js";
import { bootstrapStructuredStateFromMarkdown, normalizeHookId } from "../state/state-bootstrap.js";
import {
  describeHookLifecycle,
  localizeHookPayoffTiming,
  resolveHookPayoffTiming,
  normalizeHookPayoffTiming,
} from "./hook-lifecycle.js";
import {
  HOOK_ACTIVITY_THRESHOLDS,
  HOOK_AGENDA_LIMITS,
  HOOK_AGENDA_LOAD_THRESHOLDS,
  HOOK_PRESSURE_WEIGHTS,
  HOOK_RELEVANT_SELECTION_DEFAULTS,
  resolveHookVisibilityWindow,
  type HookAgendaLoad,
} from "./hook-policy.js";

export interface MemorySelection {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
  readonly activeHooks: ReadonlyArray<StoredHook>;
  readonly facts: ReadonlyArray<Fact>;
  readonly volumeSummaries: ReadonlyArray<VolumeSummarySelection>;
  readonly dbPath?: string;
}

export interface VolumeSummarySelection {
  readonly heading: string;
  readonly content: string;
  readonly anchor: string;
}

export const DEFAULT_HOOK_LOOKAHEAD_CHAPTERS = 3;

export async function retrieveMemorySelection(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode?: string;
  readonly mustKeep?: ReadonlyArray<string>;
}): Promise<MemorySelection> {
  const storyDir = join(params.bookDir, "story");
  const stateDir = join(storyDir, "state");
  const fallbackChapter = Math.max(0, params.chapterNumber - 1);

  await bootstrapStructuredStateFromMarkdown({
    bookDir: params.bookDir,
    fallbackChapter,
  }).catch(() => undefined);

  const [
    currentStateMarkdown,
    volumeSummariesMarkdown,
    structuredCurrentState,
    structuredHooks,
    structuredSummaries,
  ] = await Promise.all([
    readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "volume_summaries.md"), "utf-8").catch(() => ""),
    readStructuredState(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readStructuredState(join(stateDir, "hooks.json"), HooksStateSchema),
    readStructuredState(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);
  const facts = structuredCurrentState?.facts ?? parseCurrentStateFacts(
    currentStateMarkdown,
    fallbackChapter,
  );
  const narrativeQueryTerms = extractQueryTerms(
    params.goal,
    params.outlineNode,
    [],
  );
  const factQueryTerms = extractQueryTerms(
    params.goal,
    params.outlineNode,
    params.mustKeep ?? [],
  );
  const volumeSummaries = selectRelevantVolumeSummaries(
    parseVolumeSummariesMarkdown(volumeSummariesMarkdown),
    narrativeQueryTerms,
  );

  const memoryDb = openMemoryDB(params.bookDir);
  if (memoryDb) {
    try {
      if (memoryDb.getChapterCount() === 0) {
        const summaries = structuredSummaries?.rows ?? parseChapterSummariesMarkdown(
          await readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
        );
        if (summaries.length > 0) {
          memoryDb.replaceSummaries(summaries);
        }
      }
      if (memoryDb.getActiveHooks().length === 0) {
        const hooks = structuredHooks?.hooks ?? parsePendingHooksMarkdown(
          await readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
        );
        if (hooks.length > 0) {
          memoryDb.replaceHooks(hooks);
        }
      }
      if (memoryDb.getCurrentFacts().length === 0 && facts.length > 0) {
        memoryDb.replaceCurrentFacts(facts);
      }

      const activeHooks = memoryDb.getActiveHooks();

      return {
        summaries: selectRelevantSummaries(
          memoryDb.getSummaries(1, Math.max(1, params.chapterNumber - 1)),
          params.chapterNumber,
          narrativeQueryTerms,
        ),
        hooks: selectRelevantHooks(activeHooks, narrativeQueryTerms, params.chapterNumber),
        activeHooks,
        facts: selectRelevantFacts(memoryDb.getCurrentFacts(), factQueryTerms),
        volumeSummaries,
        dbPath: join(storyDir, "memory.db"),
      };
    } finally {
      memoryDb.close();
    }
  }

  const [summariesMarkdown, hooksMarkdown] = await Promise.all([
    readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
  ]);
  const summaries = structuredSummaries?.rows ?? parseChapterSummariesMarkdown(summariesMarkdown);
  const hooks = structuredHooks?.hooks ?? parsePendingHooksMarkdown(hooksMarkdown);
  const activeHooks = filterActiveHooks(hooks);

  return {
    summaries: selectRelevantSummaries(summaries, params.chapterNumber, narrativeQueryTerms),
    hooks: selectRelevantHooks(activeHooks, narrativeQueryTerms, params.chapterNumber),
    activeHooks,
    facts: selectRelevantFacts(facts, factQueryTerms),
    volumeSummaries,
  };
}

export function extractQueryTerms(goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>): string[] {
  const primaryTerms = uniqueTerms([
    ...extractTermsFromText(stripNegativeGuidance(goal)),
    ...mustKeep.flatMap((item) => extractTermsFromText(item)),
  ]);

  if (primaryTerms.length >= 2) {
    return primaryTerms.slice(0, 12);
  }

  return uniqueTerms([
    ...primaryTerms,
    ...extractTermsFromText(stripNegativeGuidance(outlineNode ?? "")),
  ]).slice(0, 12);
}

export function renderSummarySnapshot(
  summaries: ReadonlyArray<StoredSummary>,
  language: "zh" | "en" = "zh",
): string {
  if (summaries.length === 0) return "- none";

  const headers = language === "en"
    ? [
      "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  return [
    ...headers,
    ...summaries.map((summary) => [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map(escapeTableCell).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

export function renderHookSnapshot(
  hooks: ReadonlyArray<StoredHook>,
  language: "zh" | "en" = "zh",
): string {
  if (hooks.length === 0) return "- none";

  const headers = language === "en"
    ? [
      "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ];

  return [
    ...headers,
    ...hooks.map((hook) => [
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      localizeHookPayoffTiming(resolveHookPayoffTiming(hook), language),
      hook.notes,
    ].map((cell) => escapeTableCell(String(cell))).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

export function buildPlannerHookAgenda(params: {
  readonly hooks: ReadonlyArray<StoredHook>;
  readonly chapterNumber: number;
  readonly targetChapters?: number;
  readonly language?: "zh" | "en";
  readonly maxMustAdvance?: number;
  readonly maxEligibleResolve?: number;
  readonly maxStaleDebt?: number;
}): HookAgenda {
  const agendaHooks = params.hooks
    .map(normalizeStoredHook)
    .filter((hook) => !isFuturePlannedHook(hook, params.chapterNumber, 0))
    .filter((hook) => hook.status !== "resolved" && hook.status !== "deferred");
  const lifecycleEntries = agendaHooks.map((hook) => ({
    hook,
    lifecycle: describeHookLifecycle({
      payoffTiming: hook.payoffTiming,
      expectedPayoff: hook.expectedPayoff,
      notes: hook.notes,
      startChapter: hook.startChapter,
      lastAdvancedChapter: hook.lastAdvancedChapter,
      status: hook.status,
      chapterNumber: params.chapterNumber,
      targetChapters: params.targetChapters,
    }),
  }));
  const agendaLoad = resolveHookAgendaLoad(lifecycleEntries);
  const staleDebtCandidates = lifecycleEntries
    .filter((entry) => entry.lifecycle.stale)
    .sort((left, right) => (
      Number(right.lifecycle.overdue) - Number(left.lifecycle.overdue)
      || right.lifecycle.advancePressure - left.lifecycle.advancePressure
      || left.hook.lastAdvancedChapter - right.hook.lastAdvancedChapter
      || left.hook.startChapter - right.hook.startChapter
      || left.hook.hookId.localeCompare(right.hook.hookId)
    ));
  const staleDebtHooks = selectAgendaHooksWithTypeSpread({
    entries: staleDebtCandidates,
    limit: resolveAgendaLimit({
      explicitLimit: params.maxStaleDebt,
      candidateCount: staleDebtCandidates.length,
      fallbackLimit: HOOK_AGENDA_LIMITS[agendaLoad].staleDebt,
    }),
    forceInclude: (entry) => entry.lifecycle.overdue,
  }).map((entry) => entry.hook);
  const mustAdvancePool = lifecycleEntries.filter((entry) => isMustAdvanceCandidate(entry.lifecycle));
  const mustAdvanceCandidates = (mustAdvancePool.length > 0 ? mustAdvancePool : lifecycleEntries)
    .slice()
    .sort((left, right) => (
      Number(right.lifecycle.stale) - Number(left.lifecycle.stale)
      || right.lifecycle.advancePressure - left.lifecycle.advancePressure
      || left.hook.lastAdvancedChapter - right.hook.lastAdvancedChapter
      || left.hook.startChapter - right.hook.startChapter
      || left.hook.hookId.localeCompare(right.hook.hookId)
    ));
  const mustAdvanceHooks = selectAgendaHooksWithTypeSpread({
    entries: mustAdvanceCandidates,
    limit: resolveAgendaLimit({
      explicitLimit: params.maxMustAdvance,
      candidateCount: mustAdvanceCandidates.length,
      fallbackLimit: HOOK_AGENDA_LIMITS[agendaLoad].mustAdvance,
    }),
    forceInclude: (entry) => entry.lifecycle.overdue,
  }).map((entry) => entry.hook);
  const eligibleResolveCandidates = lifecycleEntries
    .filter((entry) => entry.lifecycle.readyToResolve)
    .sort((left, right) => (
      right.lifecycle.resolvePressure - left.lifecycle.resolvePressure
      || Number(right.lifecycle.stale) - Number(left.lifecycle.stale)
      || left.hook.startChapter - right.hook.startChapter
      || left.hook.hookId.localeCompare(right.hook.hookId)
    ));
  const eligibleResolveHooks = selectAgendaHooksWithTypeSpread({
    entries: eligibleResolveCandidates,
    limit: resolveAgendaLimit({
      explicitLimit: params.maxEligibleResolve,
      candidateCount: eligibleResolveCandidates.length,
      fallbackLimit: HOOK_AGENDA_LIMITS[agendaLoad].eligibleResolve,
    }),
    forceInclude: (entry) => (
      entry.lifecycle.overdue
      || entry.lifecycle.resolvePressure >= HOOK_PRESSURE_WEIGHTS.criticalResolvePressure
    ),
  }).map((entry) => entry.hook);
  const avoidNewHookFamilies = [...new Set([
    ...staleDebtHooks.map((hook) => hook.type.trim()).filter(Boolean),
    ...mustAdvanceHooks.map((hook) => hook.type.trim()).filter(Boolean),
    ...eligibleResolveHooks.map((hook) => hook.type.trim()).filter(Boolean),
  ])].slice(0, HOOK_AGENDA_LIMITS[agendaLoad].avoidFamilies);
  const pressureMap = buildHookPressureMap({
    lifecycleEntries,
    mustAdvanceHooks,
    eligibleResolveHooks,
    staleDebtHooks,
  });

  return {
    pressureMap,
    mustAdvance: mustAdvanceHooks.map((hook) => hook.hookId),
    eligibleResolve: eligibleResolveHooks.map((hook) => hook.hookId),
    staleDebt: staleDebtHooks.map((hook) => hook.hookId),
    avoidNewHookFamilies,
  };
}

function resolveHookAgendaLoad(entries: ReadonlyArray<{
  readonly hook: ReturnType<typeof normalizeStoredHook>;
  readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
}>): HookAgendaLoad {
  const pressuredEntries = entries.filter((entry) =>
    entry.lifecycle.readyToResolve
    || entry.lifecycle.stale
    || entry.lifecycle.overdue,
  );
  const staleCount = pressuredEntries.filter((entry) => entry.lifecycle.stale).length;
  const readyCount = pressuredEntries.filter((entry) => entry.lifecycle.readyToResolve).length;
  const criticalCount = pressuredEntries.filter((entry) =>
    entry.lifecycle.overdue
    || entry.lifecycle.resolvePressure >= HOOK_PRESSURE_WEIGHTS.criticalResolvePressure,
  ).length;
  const pressuredFamilies = new Set(
    pressuredEntries.map((entry) => normalizeHookType(entry.hook.type)),
  ).size;

  if (
    readyCount >= HOOK_AGENDA_LOAD_THRESHOLDS.heavyReadyCount
    || staleCount >= HOOK_AGENDA_LOAD_THRESHOLDS.heavyStaleCount
    || criticalCount >= HOOK_AGENDA_LOAD_THRESHOLDS.heavyCriticalCount
    || pressuredEntries.length >= HOOK_AGENDA_LOAD_THRESHOLDS.heavyPressuredCount
  ) {
    return "heavy";
  }
  if (
    readyCount >= HOOK_AGENDA_LOAD_THRESHOLDS.mediumReadyCount
    || staleCount >= HOOK_AGENDA_LOAD_THRESHOLDS.mediumStaleCount
    || criticalCount >= HOOK_AGENDA_LOAD_THRESHOLDS.mediumCriticalCount
    || pressuredFamilies >= HOOK_AGENDA_LOAD_THRESHOLDS.mediumPressuredFamilies
  ) {
    return "medium";
  }
  return "light";
}

function resolveAgendaLimit(params: {
  readonly explicitLimit?: number;
  readonly candidateCount: number;
  readonly fallbackLimit: number;
}): number {
  if (params.candidateCount <= 0) {
    return 0;
  }

  const limit = params.explicitLimit ?? params.fallbackLimit;
  return Math.max(1, Math.min(limit, params.candidateCount));
}

function selectAgendaHooksWithTypeSpread<T extends {
  readonly hook: {
    readonly hookId: string;
    readonly type: string;
  };
  readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
}>(params: {
  readonly entries: ReadonlyArray<T>;
  readonly limit: number;
  readonly forceInclude?: (entry: T) => boolean;
}): T[] {
  if (params.limit <= 0 || params.entries.length === 0) {
    return [];
  }

  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const selectedTypes = new Set<string>();
  const forcedEntries = params.entries.filter((entry) => params.forceInclude?.(entry) ?? false);
  const addEntry = (entry: T): void => {
    if (selectedIds.has(entry.hook.hookId) || selected.length >= params.limit) {
      return;
    }
    selected.push(entry);
    selectedIds.add(entry.hook.hookId);
    selectedTypes.add(normalizeHookType(entry.hook.type));
  };

  for (const entry of forcedEntries) {
    if (selected.length >= params.limit) {
      break;
    }
    const normalizedType = normalizeHookType(entry.hook.type);
    if (!selectedTypes.has(normalizedType)) {
      addEntry(entry);
    }
  }

  for (const entry of forcedEntries) {
    addEntry(entry);
  }

  for (const entry of params.entries) {
    if (selected.length >= params.limit) {
      break;
    }
    if (selectedIds.has(entry.hook.hookId)) {
      continue;
    }
    const normalizedType = normalizeHookType(entry.hook.type);
    if (!selectedTypes.has(normalizedType)) {
      addEntry(entry);
    }
  }

  for (const entry of params.entries) {
    if (selected.length >= params.limit) {
      break;
    }
    addEntry(entry);
  }

  return selected;
}

function normalizeHookType(type: string): string {
  return type.trim().toLowerCase() || "hook";
}

function resolveRelevantHookPrimaryLimit(entries: ReadonlyArray<{
  readonly hook: {
    readonly type: string;
  };
  readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
}>): number {
  const pressuredCount = entries.filter((entry) =>
    entry.lifecycle.readyToResolve
    || entry.lifecycle.stale
    || entry.lifecycle.overdue,
  ).length;
  return pressuredCount >= HOOK_RELEVANT_SELECTION_DEFAULTS.primary.pressuredThreshold
    ? HOOK_RELEVANT_SELECTION_DEFAULTS.primary.pressuredExpansionLimit
    : HOOK_RELEVANT_SELECTION_DEFAULTS.primary.baseLimit;
}

function resolveRelevantHookStaleLimit(
  entries: ReadonlyArray<{
    readonly hook: {
      readonly hookId: string;
      readonly type: string;
    };
    readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
  }>,
  selectedIds: ReadonlySet<string>,
): number {
  const staleCandidates = entries.filter((entry) =>
    !selectedIds.has(entry.hook.hookId)
    && (entry.lifecycle.stale || entry.lifecycle.overdue),
  );
  if (staleCandidates.length === 0) {
    return 0;
  }

  const staleFamilies = new Set(
    staleCandidates.map((entry) => normalizeHookType(entry.hook.type)),
  ).size;
  const overdueCount = staleCandidates.filter((entry) => entry.lifecycle.overdue).length;
  if (
    overdueCount >= HOOK_RELEVANT_SELECTION_DEFAULTS.stale.overdueThreshold
    || staleFamilies >= HOOK_RELEVANT_SELECTION_DEFAULTS.stale.familySpreadThreshold
  ) {
    return Math.min(HOOK_RELEVANT_SELECTION_DEFAULTS.stale.expandedLimit, staleCandidates.length);
  }

  return HOOK_RELEVANT_SELECTION_DEFAULTS.stale.defaultLimit;
}

export function isHookWithinLifecycleWindow(
  hook: StoredHook,
  chapterNumber: number,
  lifecycle: ReturnType<typeof describeHookLifecycle>,
): boolean {
  return isHookWithinChapterWindow(
    hook,
    chapterNumber,
    resolveHookVisibilityWindow(lifecycle.timing),
  );
}

function isMustAdvanceCandidate(
  lifecycle: ReturnType<typeof describeHookLifecycle>,
): boolean {
  return lifecycle.stale
    || lifecycle.readyToResolve
    || lifecycle.overdue
    || lifecycle.advancePressure >= HOOK_PRESSURE_WEIGHTS.mustAdvancePressureFloor;
}

function buildHookPressureMap(params: {
  readonly lifecycleEntries: ReadonlyArray<{
    readonly hook: ReturnType<typeof normalizeStoredHook>;
    readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
  }>;
  readonly mustAdvanceHooks: ReadonlyArray<ReturnType<typeof normalizeStoredHook>>;
  readonly eligibleResolveHooks: ReadonlyArray<ReturnType<typeof normalizeStoredHook>>;
  readonly staleDebtHooks: ReadonlyArray<ReturnType<typeof normalizeStoredHook>>;
}): HookPressure[] {
  const eligibleResolveIds = new Set(params.eligibleResolveHooks.map((hook) => hook.hookId));
  const staleDebtIds = new Set(params.staleDebtHooks.map((hook) => hook.hookId));
  const lifecycleById = new Map(
    params.lifecycleEntries.map((entry) => [entry.hook.hookId, entry.lifecycle] as const),
  );

  const orderedIds = [...new Set([
    ...params.eligibleResolveHooks.map((hook) => hook.hookId),
    ...params.staleDebtHooks.map((hook) => hook.hookId),
    ...params.mustAdvanceHooks.map((hook) => hook.hookId),
  ])];

  return orderedIds.flatMap((hookId) => {
    const hook = params.lifecycleEntries.find((entry) => entry.hook.hookId === hookId)?.hook;
    const lifecycle = lifecycleById.get(hookId);
    if (!hook || !lifecycle) {
      return [];
    }

    const movement = resolveHookMovement({
      hook,
      lifecycle,
      eligibleResolve: eligibleResolveIds.has(hookId),
      staleDebt: staleDebtIds.has(hookId),
    });
    const pressure = resolveHookPressureLevel({ lifecycle, movement });
    const reason = resolveHookPressureReason({ lifecycle, movement });

    return [{
      hookId,
      type: hook.type.trim() || "hook",
      movement,
      pressure,
      payoffTiming: lifecycle.timing,
      phase: lifecycle.phase,
      reason,
      blockSiblingHooks: staleDebtIds.has(hookId) || movement === "partial-payoff" || movement === "full-payoff",
    }];
  });
}

function resolveHookMovement(params: {
  readonly hook: ReturnType<typeof normalizeStoredHook>;
  readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
  readonly eligibleResolve: boolean;
  readonly staleDebt: boolean;
}): HookPressure["movement"] {
  if (params.eligibleResolve) {
    return "full-payoff";
  }

  const timing = params.lifecycle.timing;
  const longArc = timing === "slow-burn" || timing === "endgame";

  if (params.staleDebt && longArc) {
    return "partial-payoff";
  }

  if (params.staleDebt) {
    return "advance";
  }

  if (
    longArc
    && params.lifecycle.age <= HOOK_ACTIVITY_THRESHOLDS.longArcQuietHoldMaxAge
    && params.lifecycle.dormancy <= HOOK_ACTIVITY_THRESHOLDS.longArcQuietHoldMaxDormancy
  ) {
    return "quiet-hold";
  }

  if (params.lifecycle.dormancy >= HOOK_ACTIVITY_THRESHOLDS.refreshDormancy) {
    return "refresh";
  }

  return "advance";
}

function resolveHookPressureLevel(params: {
  readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
  readonly movement: HookPressure["movement"];
}): HookPressure["pressure"] {
  if (params.lifecycle.overdue || params.movement === "full-payoff") {
    return params.lifecycle.overdue ? "critical" : "high";
  }
  if (params.lifecycle.stale || params.movement === "partial-payoff") {
    return "high";
  }
  if (params.movement === "advance" || params.movement === "refresh") {
    return "medium";
  }
  return "low";
}

function resolveHookPressureReason(params: {
  readonly lifecycle: ReturnType<typeof describeHookLifecycle>;
  readonly movement: HookPressure["movement"];
}): HookPressure["reason"] {
  if (params.lifecycle.overdue && params.movement === "full-payoff") {
    return "overdue-payoff";
  }
  if (params.movement === "full-payoff") {
    return "ripe-payoff";
  }
  if (params.movement === "partial-payoff" || params.lifecycle.stale) {
    return "stale-promise";
  }
  if (params.movement === "quiet-hold") {
    return params.lifecycle.timing === "slow-burn" || params.lifecycle.timing === "endgame"
      ? "long-arc-hold"
      : "fresh-promise";
  }
  if (params.lifecycle.age <= HOOK_ACTIVITY_THRESHOLDS.freshPromiseAge) {
    return "fresh-promise";
  }
  return "building-debt";
}

function openMemoryDB(bookDir: string): MemoryDB | null {
  try {
    return new MemoryDB(bookDir);
  } catch {
    return null;
  }
}

async function readStructuredState<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function buildLegacyQueryTerms(goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>): string[] {
  const stopWords = new Set([
    "bring", "focus", "back", "chapter", "clear", "narrative", "before", "opening",
    "track", "the", "with", "from", "that", "this", "into", "still", "cannot",
    "current", "state", "advance", "conflict", "story", "keep", "must", "local",
  ]);

  const source = [goal, outlineNode ?? "", ...mustKeep].join(" ");
  const english = source.match(/[a-z]{4,}/gi) ?? [];
  const chinese = source.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];

  return [...new Set(
    [...english, ...chinese]
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .filter((term) => !stopWords.has(term.toLowerCase())),
  )].slice(0, 12);
}

function extractTermsFromText(text: string): string[] {
  if (!text.trim()) return [];

  const stopWords = new Set([
    "bring", "focus", "back", "chapter", "clear", "narrative", "before", "opening",
    "track", "the", "with", "from", "that", "this", "into", "still", "cannot",
    "current", "state", "advance", "conflict", "story", "keep", "must", "local",
    "does", "not", "only", "just", "then", "than",
  ]);

  const normalized = text.replace(/第\d+章/g, " ");
  const english = (normalized.match(/[a-z]{4,}/gi) ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !stopWords.has(term.toLowerCase()));

  const chineseSegments = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chinese = chineseSegments.flatMap((segment) => extractChineseFocusTerms(segment));

  return [...english, ...chinese];
}

function extractChineseFocusTerms(segment: string): string[] {
  const stripped = segment
    .replace(/^(本章|继续|重新|拉回|回到|推进|优先|围绕|聚焦|坚持|保持|把注意力|注意力|将注意力|请把注意力|先把注意力)+/, "")
    .replace(/^(处理|推进|回拉|拉回到)+/, "")
    .trim();

  const target = stripped.length >= 2 ? stripped : segment;
  const terms = new Set<string>();

  if (target.length <= 4) {
    terms.add(target);
  }

  for (let size = 2; size <= 4; size += 1) {
    if (target.length >= size) {
      terms.add(target.slice(-size));
    }
  }

  return [...terms].filter((term) => term.length >= 2);
}

function stripNegativeGuidance(text: string): string {
  if (!text) return "";

  return text
    .replace(/\b(do not|don't|avoid|without|instead of)\b[\s\S]*$/i, " ")
    .replace(/(?:不要|不让|别|禁止|避免|但不允许)[\s\S]*$/u, " ")
    .trim();
}

function uniqueTerms(terms: ReadonlyArray<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const normalized = term.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(term.trim());
  }

  return result;
}

export function parseChapterSummariesMarkdown(markdown: string): StoredSummary[] {
  const rows = parseMarkdownTableRows(markdown)
    .filter((row) => /^\d+$/.test(row[0] ?? ""));

  return rows.map((row) => ({
    chapter: parseInt(row[0]!, 10),
    title: row[1] ?? "",
    characters: row[2] ?? "",
    events: row[3] ?? "",
    stateChanges: row[4] ?? "",
    hookActivity: row[5] ?? "",
    mood: row[6] ?? "",
    chapterType: row[7] ?? "",
  }));
}

export function parsePendingHooksMarkdown(markdown: string): StoredHook[] {
  const tableRows = parseMarkdownTableRows(markdown)
    .filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");

  if (tableRows.length > 0) {
    return tableRows
      .filter((row) => normalizeHookId(row[0]).length > 0)
      .map((row) => parsePendingHookRow(row));
  }

  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean)
    .map((line, index) => ({
      hookId: `hook-${index + 1}`,
      startChapter: 0,
      type: "unspecified",
      status: "open",
      lastAdvancedChapter: 0,
      expectedPayoff: "",
      payoffTiming: undefined,
      notes: line,
    }));
}

function parsePendingHookRow(row: ReadonlyArray<string | undefined>): StoredHook {
  const legacyShape = row.length < 8;
  const payoffTiming = legacyShape ? undefined : normalizeHookPayoffTiming(row[6]);
  const notes = legacyShape ? (row[6] ?? "") : (row[7] ?? "");

  return {
    hookId: normalizeHookId(row[0]),
    startChapter: parseInteger(row[1]),
    type: row[2] ?? "",
    status: row[3] ?? "open",
    lastAdvancedChapter: parseInteger(row[4]),
    expectedPayoff: row[5] ?? "",
    payoffTiming,
    notes,
  };
}

export function parseCurrentStateFacts(
  markdown: string,
  fallbackChapter: number,
): Fact[] {
  const tableRows = parseMarkdownTableRows(markdown);
  const fieldValueRows = tableRows
    .filter((row) => row.length >= 2)
    .filter((row) => !isStateTableHeaderRow(row));

  if (fieldValueRows.length > 0) {
    const chapterFromTable = fieldValueRows.find((row) => isCurrentChapterLabel(row[0] ?? ""));
    const stateChapter = parseInteger(chapterFromTable?.[1]) || fallbackChapter;

    return fieldValueRows
      .filter((row) => !isCurrentChapterLabel(row[0] ?? ""))
      .flatMap((row): Fact[] => {
        const label = (row[0] ?? "").trim();
        const value = (row[1] ?? "").trim();
        if (!label || !value) return [];

        return [{
          subject: inferFactSubject(label),
          predicate: label,
          object: value,
          validFromChapter: stateChapter,
          validUntilChapter: null,
          sourceChapter: stateChapter,
        }];
      });
  }

  const bulletFacts = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean);

  return bulletFacts.map((line, index) => ({
    subject: "current_state",
    predicate: `note_${index + 1}`,
    object: line,
    validFromChapter: fallbackChapter,
    validUntilChapter: null,
    sourceChapter: fallbackChapter,
  }));
}

function parseMarkdownTableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .filter((line) => !line.includes("---"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean));
}

function parseVolumeSummariesMarkdown(markdown: string): VolumeSummarySelection[] {
  if (!markdown.trim()) return [];

  const sections = markdown
    .split(/^##\s+/m)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.map((section) => {
    const [headingLine, ...bodyLines] = section.split("\n");
    const heading = headingLine?.trim() ?? "";
    const content = bodyLines.join("\n").trim();

    return {
      heading,
      content,
      anchor: slugifyAnchor(heading),
    };
  }).filter((section) => section.heading.length > 0 && section.content.length > 0);
}

function isStateTableHeaderRow(row: ReadonlyArray<string>): boolean {
  const first = (row[0] ?? "").trim().toLowerCase();
  const second = (row[1] ?? "").trim().toLowerCase();
  return (first === "字段" && second === "值") || (first === "field" && second === "value");
}

function isCurrentChapterLabel(label: string): boolean {
  return /^(当前章节|current chapter)$/i.test(label.trim());
}

function inferFactSubject(label: string): string {
  if (/^(当前位置|current location)$/i.test(label)) return "protagonist";
  if (/^(主角状态|protagonist state)$/i.test(label)) return "protagonist";
  if (/^(当前目标|current goal)$/i.test(label)) return "protagonist";
  if (/^(当前限制|current constraint)$/i.test(label)) return "protagonist";
  if (/^(当前敌我|current alliances|current relationships)$/i.test(label)) return "protagonist";
  if (/^(当前冲突|current conflict)$/i.test(label)) return "protagonist";
  return "current_state";
}

function isUnresolvedHook(status: string): boolean {
  return status.trim().length === 0 || /open|待定|推进|active|progressing/i.test(status);
}

function selectRelevantSummaries(
  summaries: ReadonlyArray<StoredSummary>,
  chapterNumber: number,
  queryTerms: ReadonlyArray<string>,
): StoredSummary[] {
  return summaries
    .filter((summary) => summary.chapter < chapterNumber)
    .map((summary) => ({
      summary,
      score: scoreSummary(summary, chapterNumber, queryTerms),
      matched: matchesAny([
        summary.title,
        summary.characters,
        summary.events,
        summary.stateChanges,
        summary.hookActivity,
        summary.chapterType,
      ].join(" "), queryTerms),
    }))
    .filter((entry) => entry.matched || entry.summary.chapter >= chapterNumber - 3)
    .sort((left, right) => right.score - left.score || right.summary.chapter - left.summary.chapter)
    .slice(0, 4)
    .map((entry) => entry.summary)
    .sort((left, right) => left.chapter - right.chapter);
}

function selectRelevantHooks(
  hooks: ReadonlyArray<StoredHook>,
  queryTerms: ReadonlyArray<string>,
  chapterNumber: number,
): StoredHook[] {
  const ranked = hooks
    .map((hook) => ({
      hook,
      lifecycle: describeHookLifecycle({
        payoffTiming: hook.payoffTiming,
        expectedPayoff: hook.expectedPayoff,
        notes: hook.notes,
        startChapter: Math.max(0, hook.startChapter),
        lastAdvancedChapter: Math.max(0, hook.lastAdvancedChapter),
        status: hook.status,
        chapterNumber,
      }),
      score: scoreHook(hook, queryTerms, chapterNumber),
      matched: matchesAny(
        [hook.hookId, hook.type, hook.expectedPayoff, hook.payoffTiming ?? "", hook.notes].join(" "),
        queryTerms,
      ),
    }))
    .filter((entry) => entry.matched || isUnresolvedHook(entry.hook.status));

  const primary = selectAgendaHooksWithTypeSpread({
    entries: ranked
      .filter((entry) => (
        entry.matched
        || isHookWithinLifecycleWindow(entry.hook, chapterNumber, entry.lifecycle)
      ))
      .sort((left, right) => right.score - left.score || right.hook.lastAdvancedChapter - left.hook.lastAdvancedChapter),
    limit: resolveRelevantHookPrimaryLimit(ranked),
    forceInclude: (entry) => entry.matched && entry.lifecycle.overdue,
  });

  const selectedIds = new Set(primary.map((entry) => entry.hook.hookId));
  const stale = selectAgendaHooksWithTypeSpread({
    entries: ranked
      .filter((entry) => (
        !selectedIds.has(entry.hook.hookId)
        && !isFuturePlannedHook(entry.hook, chapterNumber)
        && (entry.lifecycle.stale || entry.lifecycle.overdue)
        && isUnresolvedHook(entry.hook.status)
      ))
      .sort((left, right) => left.hook.lastAdvancedChapter - right.hook.lastAdvancedChapter || right.score - left.score),
    limit: resolveRelevantHookStaleLimit(ranked, selectedIds),
    forceInclude: (entry) => entry.lifecycle.overdue,
  });

  return [...primary, ...stale].map((entry) => entry.hook);
}

function selectRelevantFacts(
  facts: ReadonlyArray<Fact>,
  queryTerms: ReadonlyArray<string>,
): Fact[] {
  const prioritizedPredicates = [
    /^(当前冲突|current conflict)$/i,
    /^(当前目标|current goal)$/i,
    /^(主角状态|protagonist state)$/i,
    /^(当前限制|current constraint)$/i,
    /^(当前位置|current location)$/i,
    /^(当前敌我|current alliances|current relationships)$/i,
  ];

  return facts
    .map((fact) => {
      const text = [fact.subject, fact.predicate, fact.object].join(" ");
      const priority = prioritizedPredicates.findIndex((pattern) => pattern.test(fact.predicate));
      const baseScore = priority === -1 ? 5 : 20 - priority * 2;
      const termScore = queryTerms.reduce(
        (score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0),
        0,
      );

      return {
        fact,
        score: baseScore + termScore,
        matched: matchesAny(text, queryTerms),
      };
    })
    .filter((entry) => entry.matched || entry.score >= 14)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.fact);
}

function selectRelevantVolumeSummaries(
  summaries: ReadonlyArray<VolumeSummarySelection>,
  queryTerms: ReadonlyArray<string>,
): VolumeSummarySelection[] {
  if (summaries.length === 0) return [];

  const ranked = summaries
    .map((summary, index) => {
      const text = `${summary.heading} ${summary.content}`;
      const termScore = queryTerms.reduce(
        (score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0),
        0,
      );

      return {
        index,
        summary,
        score: termScore + index,
        matched: matchesAny(text, queryTerms),
      };
    })
    .filter((entry, index, all) => entry.matched || index === all.length - 1)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.summary);

  return ranked;
}

function scoreSummary(summary: StoredSummary, chapterNumber: number, queryTerms: ReadonlyArray<string>): number {
  const text = [
    summary.title,
    summary.characters,
    summary.events,
    summary.stateChanges,
    summary.hookActivity,
    summary.chapterType,
  ].join(" ");
  const age = Math.max(0, chapterNumber - summary.chapter);
  const recencyScore = Math.max(0, 12 - age);
  const termScore = queryTerms.reduce((score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0), 0);
  return recencyScore + termScore;
}

function scoreHook(
  hook: StoredHook,
  queryTerms: ReadonlyArray<string>,
  _chapterNumber: number,
): number {
  const text = [hook.hookId, hook.type, hook.expectedPayoff, hook.payoffTiming ?? "", hook.notes].join(" ");
  const freshness = Math.max(0, hook.lastAdvancedChapter);
  const termScore = queryTerms.reduce((score, term) => score + (includesTerm(text, term) ? Math.max(8, term.length * 2) : 0), 0);
  return termScore + freshness;
}

function normalizeStoredHook(hook: StoredHook): HookRecord {
  return {
    hookId: hook.hookId,
    startChapter: Math.max(0, hook.startChapter),
    type: hook.type,
    status: normalizeStoredHookStatus(hook.status),
    lastAdvancedChapter: Math.max(0, hook.lastAdvancedChapter),
    expectedPayoff: hook.expectedPayoff,
    payoffTiming: resolveHookPayoffTiming(hook),
    notes: hook.notes,
  };
}

function normalizeStoredHookStatus(status: string): HookStatus {
  if (/^(resolved|closed|done|已回收|已解决)$/i.test(status.trim())) return "resolved";
  if (/^(deferred|paused|hold|延后|延期|搁置|暂缓)$/i.test(status.trim())) return "deferred";
  if (/^(progressing|advanced|重大推进|持续推进)$/i.test(status.trim())) return "progressing";
  return "open";
}

function filterActiveHooks(hooks: ReadonlyArray<StoredHook>): StoredHook[] {
  return hooks.filter((hook) => normalizeStoredHookStatus(hook.status) !== "resolved");
}

export function isFuturePlannedHook(
  hook: StoredHook,
  chapterNumber: number,
  lookahead: number = DEFAULT_HOOK_LOOKAHEAD_CHAPTERS,
): boolean {
  return hook.lastAdvancedChapter <= 0 && hook.startChapter > chapterNumber + lookahead;
}

export function isHookWithinChapterWindow(
  hook: StoredHook,
  chapterNumber: number,
  recentWindow: number = 5,
  lookahead: number = DEFAULT_HOOK_LOOKAHEAD_CHAPTERS,
): boolean {
  const recentCutoff = Math.max(0, chapterNumber - recentWindow);

  if (hook.lastAdvancedChapter > 0 && hook.lastAdvancedChapter >= recentCutoff) {
    return true;
  }

  if (hook.lastAdvancedChapter > 0) {
    return false;
  }

  if (hook.startChapter <= 0) {
    return true;
  }

  if (hook.startChapter >= recentCutoff && hook.startChapter <= chapterNumber) {
    return true;
  }

  return hook.startChapter > chapterNumber && hook.startChapter <= chapterNumber + lookahead;
}

function matchesAny(text: string, queryTerms: ReadonlyArray<string>): boolean {
  return queryTerms.some((term) => includesTerm(text, term));
}

function includesTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function escapeTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").trim();
}

function slugifyAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "volume-summary";
}
