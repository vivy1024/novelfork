/**
 * 终局储备 —— 防中盘塌陷的资源账。
 *
 * 长篇最常见的死法不是写不动，而是「前面把牌打光了，后面没牌可打」：
 * 头号宿敌太早出场、终极真相太早揭、金手指顶到天花板、境界一次跨三级。
 * 这些在写单章时看不出问题，等到中盘才发现无解。
 *
 * 做法是把「还剩多少牌」变成可机器检查的账：
 * - 底牌（trumpCards）：一次性资源，声明在第几卷才允许动用
 * - 台阶（ladders）：递进资源，声明总档数与当前档，不许越级
 * - 透支两问：写卷纲/推进卷时自查，任一为「是」即需回退或改纲
 *
 * 纪律：本模块只判定与解释，不自己改数据、不决定是否阻断。
 */

/** 底牌类别。对应「这本书最后能给读者的东西」。 */
export type TrumpCardKind =
  | "arch-enemy"      // 头号宿敌
  | "ultimate-truth"  // 终极真相
  | "power-ceiling"   // 金手指上限
  | "identity-end"    // 身份终点
  | "emotion-end";    // 核心情感终点

export interface TrumpCard {
  readonly id: string;
  readonly kind: TrumpCardKind;
  readonly name: string;
  /** 最早允许动用的卷序号（1 起）。早于此卷动用即透支。 */
  readonly unlockAtVolume: number;
  /** 已动用于第几卷；未动用为 null。 */
  readonly spentAtVolume?: number | null;
  readonly notes?: string;
}

export interface UpgradeLadder {
  readonly id: string;
  readonly name: string;
  /** 总档数（如境界共 9 级）。 */
  readonly totalSteps: number;
  /** 当前所处档位（0 表示尚未起步）。 */
  readonly currentStep: number;
  /** 本卷结束时允许到达的最高档。 */
  readonly maxStepThisVolume?: number;
}

export interface EndgameReserve {
  readonly trumpCards: readonly TrumpCard[];
  readonly ladders: readonly UpgradeLadder[];
}

export type OverdraftCode =
  | "trump-spent-too-early"
  | "ladder-step-skipped"
  | "ladder-near-ceiling"
  | "no-reserve-declared";

export interface OverdraftFinding {
  readonly code: OverdraftCode;
  readonly severity: "block" | "warn";
  readonly subject: string;
  /** 人话三段式，前端与叙述者直接转述，不按 code 造文案。 */
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export interface OverdraftReport {
  /** 两问：是否动用了还不该解锁的底牌 / 是否有升级线逼近天花板。 */
  readonly spentLockedTrump: boolean;
  readonly ladderExhausted: boolean;
  readonly findings: readonly OverdraftFinding[];
  /** 剩余底牌数，用于给作者一个直观的「还剩多少牌」。 */
  readonly remainingTrumps: number;
  readonly summary: string;
}

/** 台阶逼近天花板的判定线：剩余档数少于总档 1/4 视为吃紧。 */
const LADDER_TIGHT_RATIO = 0.25;

function trumpKindLabel(kind: TrumpCardKind): string {
  switch (kind) {
    case "arch-enemy": return "头号宿敌";
    case "ultimate-truth": return "终极真相";
    case "power-ceiling": return "金手指上限";
    case "identity-end": return "身份终点";
    case "emotion-end": return "核心情感终点";
    default: return kind;
  }
}

/**
 * 透支检查。
 *
 * @param reserve 当前储备账
 * @param currentVolume 正在推进的卷序号（1 起）
 */
export function checkOverdraft(
  reserve: EndgameReserve | null | undefined,
  currentVolume: number,
): OverdraftReport {
  const findings: OverdraftFinding[] = [];

  if (!reserve || (reserve.trumpCards.length === 0 && reserve.ladders.length === 0)) {
    return {
      spentLockedTrump: false,
      ladderExhausted: false,
      remainingTrumps: 0,
      findings: [{
        code: "no-reserve-declared",
        severity: "warn",
        subject: "终局储备",
        whatHappened: "这本书还没有声明终局储备（底牌与升级台阶）。",
        whyItMatters: "没有账就看不出牌还剩多少，中盘容易把宿敌、真相或境界一次性打光，后面无牌可打。",
        suggestedAction: "用 outline.volume 声明 3-5 张底牌和主要升级台阶，标明各自最早解锁的卷。",
      }],
      summary: "未声明终局储备，无法评估透支风险。",
    };
  }

  let spentLockedTrump = false;
  for (const card of reserve.trumpCards) {
    const spentAt = card.spentAtVolume ?? null;
    if (spentAt === null) continue;
    if (spentAt < card.unlockAtVolume) {
      spentLockedTrump = true;
      findings.push({
        code: "trump-spent-too-early",
        severity: "block",
        subject: card.name,
        whatHappened: `底牌「${card.name}」（${trumpKindLabel(card.kind)}）计划第 ${card.unlockAtVolume} 卷才解锁，却已在第 ${spentAt} 卷动用。`,
        whyItMatters: "这类资源是一次性的。提前打出去，后面的卷就失去了最强的那张牌，读者的期待无法在终局兑现。",
        suggestedAction: `回退这次动用，或改纲：把解锁卷提前到第 ${spentAt} 卷，并补一张新的终局底牌顶上。`,
      });
    }
  }

  let ladderExhausted = false;
  for (const ladder of reserve.ladders) {
    const total = Math.max(1, ladder.totalSteps);
    const current = Math.max(0, ladder.currentStep);

    if (typeof ladder.maxStepThisVolume === "number" && current > ladder.maxStepThisVolume) {
      ladderExhausted = true;
      findings.push({
        code: "ladder-step-skipped",
        severity: "block",
        subject: ladder.name,
        whatHappened: `升级线「${ladder.name}」本卷上限是第 ${ladder.maxStepThisVolume} 档，当前已到第 ${current} 档。`,
        whyItMatters: "越级会让后续卷的升级失去落点，爽点密度前重后轻，读者到中盘就感觉不到成长。",
        suggestedAction: `把本卷进度压回第 ${ladder.maxStepThisVolume} 档以内，或重排各卷的档位配额。`,
      });
      continue;
    }

    const remaining = total - current;
    if (remaining <= 0) {
      ladderExhausted = true;
      findings.push({
        code: "ladder-near-ceiling",
        severity: "block",
        subject: ladder.name,
        whatHappened: `升级线「${ladder.name}」已到顶（${current}/${total}）。`,
        whyItMatters: "没有台阶可升，后面只能靠横向扩展维持新鲜感，长篇很难撑住。",
        suggestedAction: "要么开新的升级维度（地图/势力层级/身份），要么把结局提前收束。",
      });
    } else if (remaining / total < LADDER_TIGHT_RATIO) {
      findings.push({
        code: "ladder-near-ceiling",
        severity: "warn",
        subject: ladder.name,
        whatHappened: `升级线「${ladder.name}」剩余 ${remaining}/${total} 档，已逼近天花板。`,
        whyItMatters: "剩余台阶不足时，后续卷的成长空间会被压缩。",
        suggestedAction: "提前规划下一个升级维度，或放慢本线推进速度。",
      });
    }
  }

  const remainingTrumps = reserve.trumpCards.filter((card) => (card.spentAtVolume ?? null) === null).length;
  return {
    spentLockedTrump,
    ladderExhausted,
    findings,
    remainingTrumps,
    summary: buildSummary(spentLockedTrump, ladderExhausted, remainingTrumps, findings.length, currentVolume),
  };
}

function buildSummary(
  spentLocked: boolean,
  exhausted: boolean,
  remainingTrumps: number,
  findingCount: number,
  currentVolume: number,
): string {
  if (findingCount === 0) {
    return `第 ${currentVolume} 卷储备健康：剩余底牌 ${remainingTrumps} 张，升级线有余量。`;
  }
  const issues: string[] = [];
  if (spentLocked) issues.push("底牌提前动用");
  if (exhausted) issues.push("升级线越级或到顶");
  const head = issues.length > 0 ? issues.join("、") : "储备吃紧";
  return `第 ${currentVolume} 卷${head}；剩余底牌 ${remainingTrumps} 张，共 ${findingCount} 条提示。`;
}

/** 从卷纲条目的 fields_json 中安全读出储备账。 */
export function parseEndgameReserve(raw: unknown): EndgameReserve | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const cards = Array.isArray(record.trumpCards) ? record.trumpCards : [];
  const ladders = Array.isArray(record.ladders) ? record.ladders : [];

  const trumpCards: TrumpCard[] = cards.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const card = item as Record<string, unknown>;
    const name = typeof card.name === "string" ? card.name.trim() : "";
    if (!name) return [];
    const unlockAt = Number(card.unlockAtVolume);
    const spent = card.spentAtVolume === null || card.spentAtVolume === undefined
      ? null
      : Number(card.spentAtVolume);
    return [{
      id: typeof card.id === "string" && card.id ? card.id : name,
      kind: normalizeKind(card.kind),
      name,
      unlockAtVolume: Number.isFinite(unlockAt) && unlockAt > 0 ? Math.trunc(unlockAt) : 1,
      spentAtVolume: spent !== null && Number.isFinite(spent) ? Math.trunc(spent) : null,
      ...(typeof card.notes === "string" ? { notes: card.notes } : {}),
    }];
  });

  const parsedLadders: UpgradeLadder[] = ladders.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ladder = item as Record<string, unknown>;
    const name = typeof ladder.name === "string" ? ladder.name.trim() : "";
    if (!name) return [];
    const total = Number(ladder.totalSteps);
    const current = Number(ladder.currentStep);
    const max = Number(ladder.maxStepThisVolume);
    return [{
      id: typeof ladder.id === "string" && ladder.id ? ladder.id : name,
      name,
      totalSteps: Number.isFinite(total) && total > 0 ? Math.trunc(total) : 1,
      currentStep: Number.isFinite(current) && current >= 0 ? Math.trunc(current) : 0,
      ...(Number.isFinite(max) ? { maxStepThisVolume: Math.trunc(max) } : {}),
    }];
  });

  if (trumpCards.length === 0 && parsedLadders.length === 0) return null;
  return { trumpCards, ladders: parsedLadders };
}

const VALID_KINDS: ReadonlySet<string> = new Set<TrumpCardKind>([
  "arch-enemy", "ultimate-truth", "power-ceiling", "identity-end", "emotion-end",
]);

function normalizeKind(value: unknown): TrumpCardKind {
  return typeof value === "string" && VALID_KINDS.has(value)
    ? value as TrumpCardKind
    : "ultimate-truth";
}
