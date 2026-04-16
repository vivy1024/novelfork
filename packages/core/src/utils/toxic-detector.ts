/**
 * Toxic Detector — deterministic web novel "poison point" detection.
 *
 * Catches common web novel anti-patterns that drive readers away:
 * - 主角重大憋屈无后手 (protagonist suffers major humiliation with no setup for payback)
 * - 第一卷设定崩坏 (worldbuilding collapse in volume 1)
 * - 金手指失效 (protagonist's cheat/advantage becomes useless)
 * - 感情线强扭 (forced romance)
 * - 无脑降智推剧情 (characters act stupid to advance plot)
 * - 断崖式节奏 (pacing cliff — action stops dead)
 * - 水字数 (obvious word padding)
 *
 * All rules are deterministic (zero LLM cost).
 * Designed to extend post-write-validator's violation format.
 */

import type { PostWriteViolation } from "../agents/post-write-validator.js";

// --- Toxic pattern definitions ---

interface ToxicPattern {
  readonly id: string;
  readonly name: string;
  readonly severity: "error" | "warning";
  readonly detect: (ctx: ToxicDetectionContext) => PostWriteViolation | null;
}

export interface ToxicDetectionContext {
  /** Current chapter content */
  readonly content: string;
  /** Chapter number */
  readonly chapterNumber: number;
  /** Recent chapter summaries (mood, events, chapterType) */
  readonly recentSummaries: ReadonlyArray<{
    readonly chapter: number;
    readonly mood: string;
    readonly events: string;
    readonly chapterType: string;
  }>;
  /** Protagonist name (from book rules) */
  readonly protagonistName?: string;
  /** Whether this is volume 1 (chapters 1-30 typically) */
  readonly isVolume1: boolean;
  /** Language */
  readonly language: "zh" | "en";
}

export interface ToxicDetectionResult {
  readonly violations: ReadonlyArray<PostWriteViolation>;
  readonly score: number; // 0-100, higher = more toxic
}

// --- Chinese toxic markers ---

/** 主角憋屈无后手 — humiliation keywords without payback setup */
const HUMILIATION_MARKERS_ZH = [
  /(?:跪下|下跪|磕头|求饶|低声下气|忍气吞声|任人宰割|任人欺凌)/,
  /(?:被.*?(?:扇|打|踢|踹|吐|羞辱|侮辱|嘲笑|鄙视))/,
  /(?:颜面尽失|颜面扫地|丢尽脸面|沦为笑柄)/,
];
const PAYBACK_SETUP_ZH = [
  /(?:暗暗|默默|心中|暗自)(?:发誓|记下|记住|决定)/,
  /(?:总有一天|迟早|等我|终有一日|来日方长)/,
  /(?:隐忍|蛰伏|韬光养晦|以退为进)/,
  /(?:嘴角.*?(?:勾起|微扬|冷笑|弧度))/,
];

/** 金手指失效 — cheat/advantage negated */
const CHEAT_NEGATED_ZH = [
  /(?:金手指|系统|外挂|传承|秘法).*?(?:失效|消失|无法使用|不起作用|失灵|被封|被夺)/,
  /(?:突然|忽然).*?(?:失去了|丧失了).*?(?:能力|力量|天赋|血脉)/,
];

/** 感情线强扭 — forced romance indicators */
const FORCED_ROMANCE_ZH = [
  /(?:一见钟情|怦然心动|脸红心跳).*?(?:才|刚|第一次)(?:见面|相遇)/,
  /(?:不由自主|情不自禁).*?(?:吻|抱|牵手|表白)/,
];

/** 水字数 — word padding patterns */
const PADDING_PATTERNS_ZH = [
  /(?:话说|且说|言归正传|闲话少叙|按下不表)/,
  /(?:不必多说|不再赘述|此处省略|暂且不提)/,
];

/** 无脑降智 — characters acting stupid */
const IDIOT_PLOT_ZH = [
  /(?:明明|明知).*?(?:却|偏偏|还是|竟然).*?(?:不|没有|忘了)/,
  /(?:为什么不|怎么不).*?(?:直接|干脆|早点)/,
];

// --- Detection functions ---

const TOXIC_PATTERNS_ZH: ReadonlyArray<ToxicPattern> = [
  {
    id: "TX-001",
    name: "主角憋屈无后手",
    severity: "error",
    detect: (ctx) => {
      if (ctx.language !== "zh") return null;
      const hasHumiliation = HUMILIATION_MARKERS_ZH.some((p) => p.test(ctx.content));
      if (!hasHumiliation) return null;
      const hasPayback = PAYBACK_SETUP_ZH.some((p) => p.test(ctx.content));
      if (hasPayback) return null;
      return {
        rule: "TX-001:主角憋屈无后手",
        severity: "error",
        description: "主角遭受重大屈辱但本章未设置任何反击伏笔或心理暗示，读者会弃书。",
        suggestion: "在憋屈场景后加入主角的内心独白（暗暗发誓/记下此仇）或暗示后续反击的线索。",
      };
    },
  },
  {
    id: "TX-002",
    name: "第一卷设定崩坏",
    severity: "error",
    detect: (ctx) => {
      if (ctx.language !== "zh" || !ctx.isVolume1) return null;
      // Check for power system contradictions in volume 1
      const contradictionMarkers = [
        /(?:之前|前面|上次).*?(?:说过|提到|设定).*?(?:但是|可是|然而|却)/,
        /(?:不是说|不是.*?吗).*?(?:怎么|为什么|为何).*?(?:又|却|反而)/,
      ];
      const hasContradiction = contradictionMarkers.some((p) => p.test(ctx.content));
      if (!hasContradiction) return null;
      return {
        rule: "TX-002:第一卷设定崩坏",
        severity: "error",
        description: "第一卷出现自相矛盾的设定描述，黄金三章期间设定崩坏是致命毒点。",
        suggestion: "检查本章设定描述是否与前文一致，第一卷必须保持设定的绝对稳定。",
      };
    },
  },
  {
    id: "TX-003",
    name: "金手指失效",
    severity: "error",
    detect: (ctx) => {
      if (ctx.language !== "zh") return null;
      const hasNegation = CHEAT_NEGATED_ZH.some((p) => p.test(ctx.content));
      if (!hasNegation) return null;
      return {
        rule: "TX-003:金手指失效",
        severity: "error",
        description: "主角的核心优势/金手指被无故剥夺，读者期待被打破。",
        suggestion: "如需限制金手指，应提前铺垫原因并给出替代方案或更强的后续回报。",
      };
    },
  },
  {
    id: "TX-004",
    name: "感情线强扭",
    severity: "warning",
    detect: (ctx) => {
      if (ctx.language !== "zh") return null;
      const hasForced = FORCED_ROMANCE_ZH.some((p) => p.test(ctx.content));
      if (!hasForced) return null;
      return {
        rule: "TX-004:感情线强扭",
        severity: "warning",
        description: "感情发展缺乏铺垫，角色间的情感转变过于突兀。",
        suggestion: "感情线需要至少2-3章的互动铺垫，避免一见钟情式的强行推进。",
      };
    },
  },
  {
    id: "TX-005",
    name: "水字数",
    severity: "warning",
    detect: (ctx) => {
      if (ctx.language !== "zh") return null;
      const paddingCount = PADDING_PATTERNS_ZH.filter((p) => p.test(ctx.content)).length;
      if (paddingCount < 2) return null;
      return {
        rule: "TX-005:水字数",
        severity: "warning",
        description: `检测到${paddingCount}处明显的水字数标记词，读者体验下降。`,
        suggestion: "删除过渡性废话，用具体的场景描写或角色行动替代。",
      };
    },
  },
  {
    id: "TX-006",
    name: "无脑降智推剧情",
    severity: "warning",
    detect: (ctx) => {
      if (ctx.language !== "zh") return null;
      const hasIdiotPlot = IDIOT_PLOT_ZH.some((p) => p.test(ctx.content));
      if (!hasIdiotPlot) return null;
      return {
        rule: "TX-006:无脑降智推剧情",
        severity: "warning",
        description: "角色行为逻辑不自洽，疑似为推动剧情而降低角色智商。",
        suggestion: "确保角色的每个决定都有合理动机，用信息差而非智商差来制造冲突。",
      };
    },
  },
  {
    id: "TX-007",
    name: "断崖式节奏",
    severity: "warning",
    detect: (ctx) => {
      if (ctx.language !== "zh") return null;
      // Check if recent chapters were all high-tension then this one is flat
      const recentMoods = ctx.recentSummaries.slice(-3).map((s) => s.mood);
      const highTensionKeywords = ["紧张", "激烈", "高潮", "战斗", "冲突", "危机"];
      const recentHighTension = recentMoods.filter((m) =>
        highTensionKeywords.some((kw) => m.includes(kw)),
      ).length;
      if (recentHighTension < 2) return null;
      // Check if current chapter is flat
      const flatKeywords = ["日常", "平淡", "休闲", "过渡", "铺垫"];
      const isFlat = flatKeywords.some((kw) => ctx.content.slice(0, 500).includes(kw));
      if (!isFlat) return null;
      return {
        rule: "TX-007:断崖式节奏",
        severity: "warning",
        description: "连续高潮后突然转入平淡日常，节奏断崖会导致读者流失。",
        suggestion: "高潮后应有余波处理（战后清点、情感释放），而非直接切入无关日常。",
      };
    },
  },
];

// --- Main detection function ---

/**
 * Run all toxic pattern detections on a chapter.
 */
export function detectToxicPatterns(ctx: ToxicDetectionContext): ToxicDetectionResult {
  const violations: PostWriteViolation[] = [];

  for (const pattern of TOXIC_PATTERNS_ZH) {
    const violation = pattern.detect(ctx);
    if (violation) {
      violations.push(violation);
    }
  }

  // Score: each error = 30 points, each warning = 15 points, cap at 100
  const score = Math.min(
    100,
    violations.reduce((sum, v) => sum + (v.severity === "error" ? 30 : 15), 0),
  );

  return { violations, score };
}
