import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  KnowledgeStateSchema,
  ResourceLedgerStateSchema,
  RuntimeStateDeltaSchema,
  StateManifestSchema,
  type HookRecord,
  type ChapterSummariesState,
  type CurrentStateState,
  type HooksState,
  type KnowledgeState,
  type ResourceLedgerState,
  type RuntimeStateDelta,
  type StateManifest,
} from "../models/runtime-state.js";
import { evaluateHookAdmission } from "../utils/hook-governance.js";
import { resolveHookPayoffTiming } from "../utils/hook-lifecycle.js";
import { validateRuntimeState } from "./state-validator.js";

export interface RuntimeStateSnapshot {
  readonly manifest: StateManifest;
  readonly currentState: CurrentStateState;
  readonly hooks: HooksState;
  readonly chapterSummaries: ChapterSummariesState;
  readonly resourceLedger: ResourceLedgerState;
  readonly knowledge: KnowledgeState;
}

/** 资源验算告警（computedBalance ≠ settler 声明的 expectedBalance）。非致命，供审计。 */
export interface ResourceLedgerWarning {
  readonly resourceId: string;
  readonly computedBalance: number;
  readonly expectedBalance: number;
}

export function applyRuntimeStateDelta(params: {
  readonly snapshot: RuntimeStateSnapshot;
  readonly delta: RuntimeStateDelta;
  readonly allowReapply?: boolean;
  readonly onResourceWarning?: (warning: ResourceLedgerWarning) => void;
}): RuntimeStateSnapshot {
  const snapshot = {
    manifest: StateManifestSchema.parse(params.snapshot.manifest),
    currentState: CurrentStateStateSchema.parse(params.snapshot.currentState),
    hooks: HooksStateSchema.parse(params.snapshot.hooks),
    chapterSummaries: ChapterSummariesStateSchema.parse(params.snapshot.chapterSummaries),
    resourceLedger: ResourceLedgerStateSchema.parse(params.snapshot.resourceLedger ?? { resources: [] }),
    knowledge: KnowledgeStateSchema.parse(params.snapshot.knowledge ?? { events: [] }),
  };
  const delta = RuntimeStateDeltaSchema.parse(params.delta);
  const allowReapply = params.allowReapply ?? false;

  if (allowReapply ? delta.chapter < snapshot.manifest.lastAppliedChapter : delta.chapter <= snapshot.manifest.lastAppliedChapter) {
    throw new Error(`delta chapter ${delta.chapter} goes backwards`);
  }

  if (delta.chapterSummary && delta.chapterSummary.chapter !== delta.chapter) {
    throw new Error(`chapter summary ${delta.chapterSummary.chapter} does not match delta chapter ${delta.chapter}`);
  }

  if (
    delta.chapterSummary
    && snapshot.chapterSummaries.rows.some((row) => row.chapter === delta.chapterSummary?.chapter)
    && !allowReapply
  ) {
    throw new Error(`duplicate summary row for chapter ${delta.chapterSummary.chapter}`);
  }

  const hooks = applyHookOps(snapshot.hooks, delta);
  const currentState = applyCurrentStatePatch(
    snapshot.currentState,
    snapshot.manifest.language,
    delta,
  );
  const chapterSummaries = applySummaryDelta(snapshot.chapterSummaries, delta, allowReapply);
  const resourceLedger = applyResourceOps(snapshot.resourceLedger, delta, params.onResourceWarning);
  const knowledge = applyKnowledgeOps(snapshot.knowledge, delta);

  const next: RuntimeStateSnapshot = {
    manifest: {
      ...snapshot.manifest,
      lastAppliedChapter: delta.chapter,
    },
    currentState,
    hooks,
    chapterSummaries,
    resourceLedger,
    knowledge,
  };

  const issues = validateRuntimeState(next);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }

  return next;
}

function applyHookOps(hooksState: HooksState, delta: RuntimeStateDelta): HooksState {
  const hooksById = new Map(hooksState.hooks.map((hook) => [hook.hookId, { ...hook }]));

  for (const hook of delta.hookOps.upsert) {
    if (!hooksById.has(hook.hookId)) {
      const admission = evaluateHookAdmission({
        candidate: {
          type: hook.type,
          expectedPayoff: hook.expectedPayoff,
          notes: hook.notes,
        },
        activeHooks: [...hooksById.values()].filter((candidate) => candidate.status !== "resolved"),
      });

      if (!admission.admit && admission.reason === "duplicate_family") {
        const matchedHookId = admission.matchedHookId;
        const existing = matchedHookId ? hooksById.get(matchedHookId) : undefined;
        if (!existing) {
          throw new Error(`duplicate active hook family: ${hook.hookId} overlaps ${admission.matchedHookId}`);
        }
        hooksById.set(existing.hookId, mergeDuplicateHookFamily(existing, hook));
        continue;
      }
    }

    hooksById.set(hook.hookId, { ...hook });
  }

  for (const hookId of delta.hookOps.resolve) {
    const existing = hooksById.get(hookId);
    if (!existing) {
      // Hook may have been cleared by a previous settlement or not yet created — skip gracefully
      continue;
    }
    hooksById.set(hookId, {
      ...existing,
      status: "resolved",
      lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, delta.chapter),
    });
  }

  for (const hookId of delta.hookOps.defer) {
    const existing = hooksById.get(hookId);
    if (!existing) {
      continue;
    }
    hooksById.set(hookId, {
      ...existing,
      status: "deferred",
      lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, delta.chapter),
    });
  }

  return {
    hooks: [...hooksById.values()].sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    )),
  };
}

function applyResourceOps(
  ledger: ResourceLedgerState,
  delta: RuntimeStateDelta,
  onWarning?: (warning: ResourceLedgerWarning) => void,
): ResourceLedgerState {
  const byId = new Map(ledger.resources.map((r) => [r.resourceId, { ...r, history: [...r.history] }]));

  for (const op of delta.resourceOps) {
    const existing = byId.get(op.resourceId);
    const oldBalance = existing?.balance ?? 0;
    const computedBalance = oldBalance + op.delta;

    // 代码层验算（非 LLM）：settler 若声明期末值且与 old+delta 不符 → 告警（非致命）
    if (op.expectedBalance !== undefined && op.expectedBalance !== computedBalance) {
      onWarning?.({ resourceId: op.resourceId, computedBalance, expectedBalance: op.expectedBalance });
    }

    const historyEntry = { chapter: delta.chapter, delta: op.delta, reason: op.reason };
    byId.set(op.resourceId, existing
      ? { ...existing, name: op.name ?? existing.name, balance: computedBalance, lastChapter: delta.chapter, history: [...existing.history, historyEntry] }
      : { resourceId: op.resourceId, name: op.name ?? "", balance: computedBalance, lastChapter: delta.chapter, history: [historyEntry] });
  }

  return {
    resources: [...byId.values()].sort((a, b) => a.resourceId.localeCompare(b.resourceId)),
  };
}

function applyKnowledgeOps(state: KnowledgeState, delta: RuntimeStateDelta): KnowledgeState {
  if (delta.knowledgeOps.length === 0) {
    return { events: [...state.events] };
  }
  // 去重：同 (characterId, fact) 只保留最早习得章（learnedAtChapter 取 min）
  const byKey = new Map<string, typeof state.events[number]>();
  for (const ev of [...state.events, ...delta.knowledgeOps]) {
    const key = `${ev.characterId}::${ev.fact}`.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || ev.learnedAtChapter < existing.learnedAtChapter) {
      byKey.set(key, ev);
    }
  }
  return {
    events: [...byKey.values()].sort((a, b) =>
      a.learnedAtChapter - b.learnedAtChapter || a.characterId.localeCompare(b.characterId),
    ),
  };
}

/**
 * 信息边界校验（P2-2）：给定 POV 角色与当前章，返回该角色"还不该知道"的事实
 * （learnedAtChapter > 当前章，即未来才会习得的信息）。供写章 POV 过滤 / 审查 dim9/dim29。
 */
export function findKnowledgeViolations(
  knowledge: KnowledgeState,
  povCharacterId: string,
  currentChapter: number,
): ReadonlyArray<{ readonly fact: string; readonly learnedAtChapter: number }> {
  return knowledge.events
    .filter((ev) => ev.characterId === povCharacterId && ev.learnedAtChapter > currentChapter)
    .map((ev) => ({ fact: ev.fact, learnedAtChapter: ev.learnedAtChapter }));
}

function mergeDuplicateHookFamily(existing: HookRecord, incoming: HookRecord): HookRecord {
  const expectedPayoff = preferRicherText(existing.expectedPayoff, incoming.expectedPayoff);
  const notes = preferRicherText(existing.notes, incoming.notes);
  const advanced = Math.max(existing.lastAdvancedChapter, incoming.lastAdvancedChapter);
  const progressed = advanced > existing.lastAdvancedChapter;

  return {
    ...existing,
    startChapter: Math.min(existing.startChapter, incoming.startChapter),
    type: preferRicherText(existing.type, incoming.type),
    status: progressed
      ? "progressing"
      : existing.status === "progressing" || incoming.status === "progressing"
        ? "progressing"
        : existing.status,
    lastAdvancedChapter: advanced,
    expectedPayoff,
    payoffTiming: resolveHookPayoffTiming({
      payoffTiming: incoming.payoffTiming ?? existing.payoffTiming,
      expectedPayoff,
      notes,
    }),
    notes,
  };
}

function preferRicherText(primary: string, fallback: string): string {
  const left = primary.trim();
  const right = fallback.trim();

  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  return right.length > left.length ? right : left;
}

function applyCurrentStatePatch(
  currentState: CurrentStateState,
  language: "zh" | "en",
  delta: RuntimeStateDelta,
): CurrentStateState {
  if (!delta.currentStatePatch) {
    return {
      chapter: delta.chapter,
      facts: [...currentState.facts],
    };
  }

  const nextFacts = [...currentState.facts];
  const labels = language === "en"
    ? {
      currentLocation: ["Current Location", "当前位置"],
      protagonistState: ["Protagonist State", "主角状态"],
      currentGoal: ["Current Goal", "当前目标"],
      currentConstraint: ["Current Constraint", "当前限制"],
      currentAlliances: ["Current Alliances", "Current Relationships", "当前敌我"],
      currentConflict: ["Current Conflict", "当前冲突"],
    }
    : {
      currentLocation: ["当前位置", "Current Location"],
      protagonistState: ["主角状态", "Protagonist State"],
      currentGoal: ["当前目标", "Current Goal"],
      currentConstraint: ["当前限制", "Current Constraint"],
      currentAlliances: ["当前敌我", "Current Alliances", "Current Relationships"],
      currentConflict: ["当前冲突", "Current Conflict"],
    };

  for (const [patchKey, aliases] of Object.entries(labels) as Array<[
    keyof typeof labels,
    string[],
  ]>) {
    const value = delta.currentStatePatch[patchKey];
    if (value === undefined) continue;

    for (let index = nextFacts.length - 1; index >= 0; index -= 1) {
      const predicate = nextFacts[index]?.predicate ?? "";
      if (aliases.some((alias) => alias.toLowerCase() === predicate.toLowerCase())) {
        nextFacts.splice(index, 1);
      }
    }

    nextFacts.push({
      subject: "protagonist",
      predicate: aliases[0]!,
      object: value,
      validFromChapter: delta.chapter,
      validUntilChapter: null,
      sourceChapter: delta.chapter,
    });
  }

  return {
    chapter: delta.chapter,
    facts: nextFacts.sort((left, right) => (
      left.predicate.localeCompare(right.predicate)
      || left.object.localeCompare(right.object)
    )),
  };
}

function applySummaryDelta(
  state: ChapterSummariesState,
  delta: RuntimeStateDelta,
  allowReapply = false,
): ChapterSummariesState {
  if (!delta.chapterSummary) {
    return {
      rows: [...state.rows].sort((left, right) => left.chapter - right.chapter),
    };
  }

  return {
    rows: [
      ...(allowReapply ? state.rows.filter((row) => row.chapter !== delta.chapterSummary!.chapter) : state.rows),
      delta.chapterSummary,
    ].sort((left, right) => left.chapter - right.chapter),
  };
}
