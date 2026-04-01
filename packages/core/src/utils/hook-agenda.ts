import type { HookAgenda, HookPressure } from "../models/input-governance.js";
import type { HookRecord, HookStatus } from "../models/runtime-state.js";
import type { StoredHook } from "../state/memory-db.js";
import { describeHookLifecycle, resolveHookPayoffTiming } from "./hook-lifecycle.js";
import {
  HOOK_ACTIVITY_THRESHOLDS,
  HOOK_AGENDA_LIMITS,
  HOOK_AGENDA_LOAD_THRESHOLDS,
  HOOK_PRESSURE_WEIGHTS,
  HOOK_RELEVANT_SELECTION_DEFAULTS,
  resolveHookVisibilityWindow,
  type HookAgendaLoad,
} from "./hook-policy.js";

type HookLifecycle = ReturnType<typeof describeHookLifecycle>;
type NormalizedStoredHook = HookRecord;

interface HookAgendaEntry {
  readonly hook: NormalizedStoredHook;
  readonly lifecycle: HookLifecycle;
}

interface HookSelectionEntry {
  readonly hook: {
    readonly hookId: string;
    readonly type: string;
  };
  readonly lifecycle: HookLifecycle;
}

export const DEFAULT_HOOK_LOOKAHEAD_CHAPTERS = 3;

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

function resolveHookAgendaLoad(entries: ReadonlyArray<HookAgendaEntry>): HookAgendaLoad {
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

export function selectAgendaHooksWithTypeSpread<T extends HookSelectionEntry>(params: {
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

export function resolveRelevantHookPrimaryLimit(entries: ReadonlyArray<HookSelectionEntry>): number {
  const pressuredCount = entries.filter((entry) =>
    entry.lifecycle.readyToResolve
    || entry.lifecycle.stale
    || entry.lifecycle.overdue,
  ).length;
  return pressuredCount >= HOOK_RELEVANT_SELECTION_DEFAULTS.primary.pressuredThreshold
    ? HOOK_RELEVANT_SELECTION_DEFAULTS.primary.pressuredExpansionLimit
    : HOOK_RELEVANT_SELECTION_DEFAULTS.primary.baseLimit;
}

export function resolveRelevantHookStaleLimit(
  entries: ReadonlyArray<HookSelectionEntry>,
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
  lifecycle: HookLifecycle,
): boolean {
  return isHookWithinChapterWindow(
    hook,
    chapterNumber,
    resolveHookVisibilityWindow(lifecycle.timing),
  );
}

function isMustAdvanceCandidate(lifecycle: HookLifecycle): boolean {
  return lifecycle.stale
    || lifecycle.readyToResolve
    || lifecycle.overdue
    || lifecycle.advancePressure >= HOOK_PRESSURE_WEIGHTS.mustAdvancePressureFloor;
}

function buildHookPressureMap(params: {
  readonly lifecycleEntries: ReadonlyArray<HookAgendaEntry>;
  readonly mustAdvanceHooks: ReadonlyArray<NormalizedStoredHook>;
  readonly eligibleResolveHooks: ReadonlyArray<NormalizedStoredHook>;
  readonly staleDebtHooks: ReadonlyArray<NormalizedStoredHook>;
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
  readonly lifecycle: HookLifecycle;
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
  readonly lifecycle: HookLifecycle;
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
  readonly lifecycle: HookLifecycle;
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

export function filterActiveHooks(hooks: ReadonlyArray<StoredHook>): StoredHook[] {
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
