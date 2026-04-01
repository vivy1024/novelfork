import type { HookPayoffTiming } from "../models/runtime-state.js";

type HookPhase = "opening" | "middle" | "late";

interface LifecycleProfile {
  readonly earliestResolveAge: number;
  readonly staleDormancy: number;
  readonly overdueAge: number;
  readonly minimumPhase: HookPhase;
  readonly resolveBias: number;
}

const TIMING_PROFILES: Record<HookPayoffTiming, LifecycleProfile> = {
  immediate: {
    earliestResolveAge: 1,
    staleDormancy: 1,
    overdueAge: 3,
    minimumPhase: "opening",
    resolveBias: 5,
  },
  "near-term": {
    earliestResolveAge: 1,
    staleDormancy: 2,
    overdueAge: 5,
    minimumPhase: "opening",
    resolveBias: 4,
  },
  "mid-arc": {
    earliestResolveAge: 2,
    staleDormancy: 4,
    overdueAge: 8,
    minimumPhase: "opening",
    resolveBias: 3,
  },
  "slow-burn": {
    earliestResolveAge: 4,
    staleDormancy: 5,
    overdueAge: 12,
    minimumPhase: "middle",
    resolveBias: 2,
  },
  endgame: {
    earliestResolveAge: 6,
    staleDormancy: 6,
    overdueAge: 16,
    minimumPhase: "late",
    resolveBias: 1,
  },
};

const PHASE_WEIGHT: Record<HookPhase, number> = {
  opening: 0,
  middle: 1,
  late: 2,
};

const LABELS: Record<"zh" | "en", Record<HookPayoffTiming, string>> = {
  en: {
    immediate: "immediate",
    "near-term": "near-term",
    "mid-arc": "mid-arc",
    "slow-burn": "slow-burn",
    endgame: "endgame",
  },
  zh: {
    immediate: "立即",
    "near-term": "近期",
    "mid-arc": "中程",
    "slow-burn": "慢烧",
    endgame: "终局",
  },
};

const TIMING_ALIASES: Array<[HookPayoffTiming, RegExp]> = [
  ["immediate", /^(?:立即|马上|当章|本章|下一章|immediate|instant|next(?:\s+chapter|\s+beat)?|right\s+away)$/i],
  ["near-term", /^(?:近期|近几章|短线|soon|short(?:\s+run)?|near(?:\s*-\s*|\s+)term|current\s+sequence)$/i],
  ["mid-arc", /^(?:中程|中期|卷中|mid(?:\s*-\s*|\s+)arc|mid(?:\s*-\s*|\s+)book|middle)$/i],
  ["slow-burn", /^(?:慢烧|长线|后续|later|late(?:r)?|long(?:\s*-\s*|\s+)arc|slow(?:\s*-\s*|\s+)burn)$/i],
  ["endgame", /^(?:终局|终章|大结局|最终|climax|finale|endgame|late\s+book)$/i],
];

const SIGNAL_PATTERNS: Array<[HookPayoffTiming, RegExp]> = [
  ["endgame", /(终局|终章|大结局|最终揭晓|最终摊牌|climax|finale|endgame|final reveal|last act)/i],
  ["immediate", /(当章|本章|下一章|马上|立刻|即刻|immediate|next chapter|right away|at once)/i],
  ["near-term", /(近期|近几章|很快|短线|soon|near-term|short run|current sequence)/i],
  ["mid-arc", /(中期|卷中|本卷中段|mid-book|mid arc|middle of the arc)/i],
  ["slow-burn", /(长线|慢烧|后续发酵|慢慢揭开|later|slow burn|long arc|long tail)/i],
];

export function normalizeHookPayoffTiming(value: string | undefined | null): HookPayoffTiming | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  for (const [timing, pattern] of TIMING_ALIASES) {
    if (pattern.test(normalized)) {
      return timing;
    }
  }

  return undefined;
}

export function inferHookPayoffTiming(params: {
  readonly expectedPayoff?: string;
  readonly notes?: string;
}): HookPayoffTiming {
  const combined = [params.expectedPayoff, params.notes]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .trim();
  if (!combined) return "mid-arc";

  for (const [timing, pattern] of SIGNAL_PATTERNS) {
    if (pattern.test(combined)) {
      return timing;
    }
  }

  return "mid-arc";
}

export function resolveHookPayoffTiming(params: {
  readonly payoffTiming?: string | null;
  readonly expectedPayoff?: string;
  readonly notes?: string;
}): HookPayoffTiming {
  return normalizeHookPayoffTiming(params.payoffTiming)
    ?? inferHookPayoffTiming({
      expectedPayoff: params.expectedPayoff,
      notes: params.notes,
    });
}

export function localizeHookPayoffTiming(
  timing: HookPayoffTiming,
  language: "zh" | "en",
): string {
  return LABELS[language][timing];
}

export function describeHookLifecycle(params: {
  readonly payoffTiming?: string | null;
  readonly expectedPayoff?: string;
  readonly notes?: string;
  readonly startChapter: number;
  readonly lastAdvancedChapter: number;
  readonly status: string;
  readonly chapterNumber: number;
  readonly targetChapters?: number;
}): {
  readonly timing: HookPayoffTiming;
  readonly phase: HookPhase;
  readonly age: number;
  readonly dormancy: number;
  readonly readyToResolve: boolean;
  readonly stale: boolean;
  readonly overdue: boolean;
  readonly advancePressure: number;
  readonly resolvePressure: number;
} {
  const timing = resolveHookPayoffTiming(params);
  const profile = TIMING_PROFILES[timing];
  const phase = resolveHookPhase(params.chapterNumber, params.targetChapters);
  const age = Math.max(0, params.chapterNumber - Math.max(1, params.startChapter));
  const lastTouchChapter = Math.max(params.startChapter, params.lastAdvancedChapter);
  const dormancy = Math.max(0, params.chapterNumber - Math.max(1, lastTouchChapter));
  const explicitProgressing = /^(progressing|advanced|重大推进|持续推进)$/i.test(params.status.trim());
  const phaseReady = PHASE_WEIGHT[phase] >= PHASE_WEIGHT[profile.minimumPhase];
  const recentlyTouched = dormancy <= 1;
  const overdue = phaseReady && age >= profile.overdueAge;
  const cadenceReady = timing === "slow-burn"
    ? phase === "late" || overdue
    : timing === "endgame"
      ? phase === "late"
      : true;
  const momentum = explicitProgressing || recentlyTouched;
  const stale = phaseReady && (
    dormancy >= profile.staleDormancy
    || (overdue && !momentum)
  );
  const readyToResolve = phaseReady
    && cadenceReady
    && age >= profile.earliestResolveAge
    && (momentum || (overdue && explicitProgressing));

  return {
    timing,
    phase,
    age,
    dormancy,
    readyToResolve,
    stale,
    overdue,
    advancePressure: age + dormancy + (stale ? 8 : 0) + (overdue ? 6 : 0),
    resolvePressure: readyToResolve
      ? profile.resolveBias * 10 + (explicitProgressing ? 5 : 0) + Math.min(12, dormancy * 2) + (overdue ? 10 : 0)
      : 0,
  };
}

function resolveHookPhase(chapterNumber: number, targetChapters?: number): HookPhase {
  if (targetChapters && targetChapters > 0) {
    const progress = chapterNumber / targetChapters;
    if (progress >= 0.72) return "late";
    if (progress >= 0.33) return "middle";
    return "opening";
  }

  if (chapterNumber >= 24) return "late";
  if (chapterNumber >= 8) return "middle";
  return "opening";
}
