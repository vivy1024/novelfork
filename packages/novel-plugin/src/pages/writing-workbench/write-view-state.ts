/**
 * 写作视图状态 —— 把 write.preflight 的结构化结果翻译成一屏可读的「就绪条」。
 *
 * 纯逻辑，无 React 依赖，便于单测。
 * 纪律：文案一律来自 preflight 的 explanation（人话三段式），此处不按 code 造词。
 */

import type { ViewId } from "./ide/use-panel-manager";

export type ReadyLight = "green" | "yellow" | "red" | "unknown";

export interface ReadyCheckItem {
  readonly code: string;
  /** 就绪条上的短标签，如「本章指示」「近章记忆」 */
  readonly label: string;
  readonly state: "ok" | "warn" | "block";
  /** 直接取自 preflight message */
  readonly message?: string;
  /** 人话三段式，展开时显示 */
  readonly explanation?: {
    readonly whatHappened: string;
    readonly whyItMatters: string;
    readonly suggestedAction: string;
  };
  /** 一键修：对应的修复动作 id（无则不显示按钮） */
  readonly fixAction?: WriteFixActionId;
}

export type WriteFixActionId =
  | "settle-range"
  | "enable-style"
  | "review-hooks"
  | "set-volume"
  | "review-pending"
  | "adjust-word-target"
  | "open-focus";

export interface WriteViewModel {
  readonly light: ReadyLight;
  readonly canWrite: boolean;
  readonly chapterNumber: number;
  readonly resolvedDirective: string | null;
  readonly needsUserConfirm: boolean;
  readonly volumeLabel: string | null;
  readonly platformLabel: string | null;
  readonly recentChapters: readonly { readonly number: number; readonly summary: string }[];
  readonly checks: readonly ReadyCheckItem[];
  /** 顶部一句话：当前能不能写、缺什么 */
  readonly headline: string;
  /** 已落稿正式章数；推荐章号 ≤ 此值则该章已有正文。 */
  readonly formalChapterCount: number;
  /** 平台/书籍推荐的单章目标字数；缺省 0。 */
  readonly wordTarget: number;
  /** 推荐章号对应的正文是否已经落稿。 */
  readonly alreadyWritten: boolean;
  /**
   * 起书引导：新书既没有本章焦点也没有大纲时，就绪条换成引导卡而不是红色报错。
   * 只在「缺本章方向」是唯一阻断项时出现；有其它阻断（书籍读不到、记忆为空等）照常报错。
   */
  readonly onboarding: WriteOnboarding | null;
}

/**
 * 起书引导卡。
 * - answer-guide：还没答建书十一问 → 去作品总览回答十一问；
 * - fill-focus：答过十一问（或书里已有章节）但本章焦点仍空 → 定位到创作罗盘。
 */
export interface WriteOnboarding {
  readonly kind: "answer-guide" | "fill-focus";
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
}

export interface BuildWriteViewModelOptions {
  /**
   * 作品总览此刻是否仍会显示建书十一问（书里没有章节且本机没记过完成）。
   * 与画布共用 new-book-guide-state 的判据。
   */
  readonly newBookGuidePending?: boolean;
}

const ONBOARDING_CARDS: Record<WriteOnboarding["kind"], WriteOnboarding> = {
  "answer-guide": {
    kind: "answer-guide",
    title: "先回答建书十一问",
    description: "新书还没有本章焦点和大纲，写章不知道往哪写。先回答十一问（每题都能跳过），会按你的回答搭好主角、世界观等作品基础；也可以直接在下方写一句本章要发生什么。",
    actionLabel: "打开建书十一问",
  },
  "fill-focus": {
    kind: "fill-focus",
    title: "补全本章焦点",
    description: "还没有本章焦点。在创作罗盘写下本章目标，保存后写章会按它推进；也可以直接在下方写一句本章要发生什么。",
    actionLabel: "去填创作罗盘",
  },
};

interface RawExplanation {
  whatHappened?: unknown;
  whyItMatters?: unknown;
  suggestedAction?: unknown;
}

interface RawDiagnostic {
  code?: unknown;
  message?: unknown;
  explanation?: RawExplanation;
  kind?: unknown;
}

/**
 * blocker/warning code → 就绪条标签与修复动作。
 *
 * 标签必须叫得出作者能在界面上找到的东西。`style-disabled` 的判据是
 * 当前项目 `.novelfork/skills/` 扫描不到可生效 Writing Skill（见 write-preflight），对应界面是
 * Writing Skills 面板；旧 `book.json` 启用字段与「文风预设」（enabledPresetIds）都已迁移下线，
 * 继续用那个词只会把作者引到不存在的入口。
 */
const CHECK_META: Record<string, { label: string; fixAction?: WriteFixActionId }> = {
  "missing-directive": { label: "本章指示", fixAction: "open-focus" },
  "short-directive": { label: "本章指示", fixAction: "open-focus" },
  "focus-default-only": { label: "本章指示", fixAction: "open-focus" },
  "empty-recent-progress": { label: "近章记忆", fixAction: "settle-range" },
  "empty-chapter-summary": { label: "章摘要", fixAction: "settle-range" },
  "high-risk-pending": { label: "待确认事件", fixAction: "review-pending" },
  "hooks-overdue": { label: "伏笔到期", fixAction: "review-hooks" },
  "style-disabled": { label: "写作技能", fixAction: "enable-style" },
  "skills-not-acknowledged": { label: "相关写作技能未读" },
  "volume-focus-missing": { label: "卷纲", fixAction: "set-volume" },
  "volume-range-drift": { label: "章号不在本卷" },
  "platform-target-mismatch": { label: "平台字数", fixAction: "adjust-word-target" },
  "audit-stale": { label: "审计已过期" },
  "book-not-found": { label: "书籍绑定" },
};

/** 未登记的 code 不把英文代号露给作者；详情仍来自 preflight 的 message / explanation。 */
const FALLBACK_CHECK_LABEL = "其他提醒";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readExplanation(raw: RawExplanation | undefined): ReadyCheckItem["explanation"] {
  if (!raw) return undefined;
  const whatHappened = text(raw.whatHappened);
  const whyItMatters = text(raw.whyItMatters);
  const suggestedAction = text(raw.suggestedAction);
  if (!whatHappened && !whyItMatters && !suggestedAction) return undefined;
  return { whatHappened, whyItMatters, suggestedAction };
}

function toCheck(raw: RawDiagnostic, state: "warn" | "block"): ReadyCheckItem {
  const code = text(raw.code) || "other";
  const meta = CHECK_META[code];
  return {
    code,
    label: meta?.label ?? FALLBACK_CHECK_LABEL,
    state,
    message: text(raw.message) || undefined,
    explanation: readExplanation(raw.explanation),
    ...(meta?.fixAction ? { fixAction: meta.fixAction } : {}),
  };
}

function asArray(value: unknown): RawDiagnostic[] {
  return Array.isArray(value) ? value.filter((item): item is RawDiagnostic => Boolean(item) && typeof item === "object") : [];
}

/** 已通过的检查项：只在对应问题不存在时才显示为 ok。 */
function passedChecks(input: {
  hasDirective: boolean;
  hasRecentMemory: boolean;
  codes: ReadonlySet<string>;
}): ReadyCheckItem[] {
  const out: ReadyCheckItem[] = [];
  const directiveIssue = input.codes.has("missing-directive")
    || input.codes.has("short-directive")
    || input.codes.has("focus-default-only");
  if (input.hasDirective && !directiveIssue) {
    out.push({ code: "directive-ok", label: "本章指示", state: "ok" });
  }
  const memoryIssue = input.codes.has("empty-recent-progress");
  if (input.hasRecentMemory && !memoryIssue) {
    out.push({ code: "recent-memory-ok", label: "近章记忆", state: "ok" });
  }
  return out;
}

/**
 * 把 write.preflight 返回体转成写作视图模型。
 * 输入是宽松的 unknown，以容忍 Runtime 返回体演进。
 */
export function buildWriteViewModel(preflight: unknown, options: BuildWriteViewModelOptions = {}): WriteViewModel {
  const record = preflight && typeof preflight === "object"
    ? preflight as Record<string, unknown>
    : null;

  if (!record) {
    return {
      light: "unknown",
      canWrite: false,
      chapterNumber: 0,
      resolvedDirective: null,
      needsUserConfirm: false,
      volumeLabel: null,
      platformLabel: null,
      recentChapters: [],
      checks: [],
      headline: "尚未检查写前状态，点「检查就绪」开始。",
      formalChapterCount: 0,
      wordTarget: 0,
      alreadyWritten: false,
      onboarding: null,
    };
  }

  const blockers = asArray(record.blockers).map((item) => toCheck(item, "block"));
  const warnings = asArray(record.warningItems).map((item) => toCheck(item, "warn"));
  const codes = new Set<string>([...blockers, ...warnings].map((item) => item.code));

  const resolvedDirective = text(record.resolvedDirective) || null;
  const recentChapters = Array.isArray(record.recentChapters)
    ? record.recentChapters
      .map((item) => {
        const entry = item as { number?: unknown; summary?: unknown };
        const number = Number(entry.number);
        return Number.isFinite(number) && number > 0
          ? { number, summary: text(entry.summary) }
          : null;
      })
      .filter((item): item is { number: number; summary: string } => item !== null)
    : [];

  const ok = record.ok === true;
  const onboarding = resolveOnboarding(record, blockers, options);
  const checks = [
    ...passedChecks({
      hasDirective: Boolean(resolvedDirective),
      hasRecentMemory: recentChapters.length > 0,
      codes,
    }),
    // 引导卡已经说明缺本章方向，不再在清单里重复一条红色 ×。
    ...(onboarding ? blockers.filter((item) => item.code !== "missing-directive") : blockers),
    ...warnings,
  ];

  const volume = record.currentVolume as { title?: unknown; goal?: unknown } | null | undefined;
  const volumeTitle = text(volume?.title);
  const volumeGoal = text(volume?.goal);
  const platform = record.platform as { label?: unknown; chapterTargetStatus?: unknown } | null | undefined;

  const chapterNumber = Number(record.chapterNumber);
  const resolvedChapter = Number.isFinite(chapterNumber) && chapterNumber > 0 ? chapterNumber : 0;
  const formalChapterCountRaw = Number(record.formalChapterCount);
  const formalChapterCount = Number.isFinite(formalChapterCountRaw) && formalChapterCountRaw > 0
    ? formalChapterCountRaw
    : 0;
  const recommendedWords = (platform as { recommendedChapterWords?: { ideal?: unknown } } | null | undefined)
    ?.recommendedChapterWords;
  const wordTargetRaw = Number(recommendedWords?.ideal);
  const wordTarget = Number.isFinite(wordTargetRaw) && wordTargetRaw > 0 ? wordTargetRaw : 0;
  const alreadyWritten = resolvedChapter > 0 && (
    formalChapterCount >= resolvedChapter
    || recentChapters.some((item) => item.number === resolvedChapter)
  );
  const light: ReadyLight = onboarding ? "unknown" : ok ? (warnings.length > 0 ? "yellow" : "green") : "red";
  const headline = alreadyWritten
    ? `第 ${resolvedChapter} 章已有正文，可直接打开继续改。`
    : onboarding
      ? onboarding.title
      : ok
      ? warnings.length > 0
        ? `可以开写第 ${resolvedChapter} 章，有 ${warnings.length} 条提醒。`
        : `可以开写第 ${resolvedChapter} 章。`
      : blockers[0]?.message
        ?? "写前上下文未就绪，请先处理阻断项。";

  return {
    light,
    canWrite: ok,
    chapterNumber: resolvedChapter,
    resolvedDirective,
    needsUserConfirm: record.needsUserConfirm === true,
    volumeLabel: volumeTitle ? (volumeGoal ? `${volumeTitle} · ${volumeGoal}` : volumeTitle) : null,
    platformLabel: text(platform?.label) || null,
    recentChapters,
    checks,
    headline,
    formalChapterCount,
    wordTarget,
    alreadyWritten,
    onboarding,
  };
}

/**
 * 新书缺本章方向时给引导而不是报错。
 *
 * 条件：唯一的阻断项是 missing-directive，且 preflight 读到的当前焦点不可用
 * （新书既没有焦点也没有大纲）。还有其它阻断（书籍读不到、数据损坏、近章记忆为空）
 * 时返回 null，照常显示红色报错。
 */
function resolveOnboarding(
  record: Record<string, unknown>,
  blockers: readonly ReadyCheckItem[],
  options: BuildWriteViewModelOptions,
): WriteOnboarding | null {
  if (blockers.length === 0 || blockers.some((item) => item.code !== "missing-directive")) return null;
  const focus = record.currentFocus as { status?: unknown; content?: unknown } | null | undefined;
  if (focus?.status === "available" && text(focus.content)) return null;
  return ONBOARDING_CARDS[options.newBookGuidePending ? "answer-guide" : "fill-focus"];
}

/**
 * 一键修动作 → 下一步怎么走。
 *
 * 纪律：任何会写入的修复都必须经叙述者与 Runtime 权限确认（kind="narrator"），
 * 前端不得静默 POST 写数据；只有导航类动作（view / settings / lore-panel /
 * write-compass）才由前端直接完成。
 *
 * 导航目标必须与 preflight 的判据同源，否则作者点完按钮改了东西、重跑
 * preflight 却发现问题还在。参见 CHECK_META 上方注释。
 */
export interface FixActionPlan {
  readonly kind: "narrator" | "view" | "settings" | "lore-panel" | "write-compass";
  /** kind=narrator 时发给叙述者的请求文本 */
  readonly message?: string;
  /** kind=view 时要切到的侧栏视图 */
  readonly view?: Extract<ViewId, "characters-lore" | "storyline" | "skills-style" | "tools" | "explorer">;
  /** kind=settings 时要定位到的写作设置分区 */
  readonly settingsSection?: SettingsSectionId;
  /** kind=lore-panel 时要在经纬面板里定位的分类 */
  readonly loreCategory?: string;
  readonly label: string;
}

export type SettingsSectionId = "basic" | "writing-skills" | "narrative-memory";

export function planFixAction(
  action: WriteFixActionId,
  context: { readonly chapterNumber: number; readonly formalChapterCount?: number },
): FixActionPlan {
  switch (action) {
    case "settle-range": {
      const to = Math.max(1, context.formalChapterCount ?? Math.max(1, context.chapterNumber - 1));
      return {
        kind: "narrator",
        message: `近章记忆为空。请用 memory.settle_range 回填第 1–${to} 章的叙事记忆，完成后重新 write.preflight 并告诉我结果。`,
        label: "补结算历史章节",
      };
    }
    case "set-volume":
      return {
        kind: "narrator",
        message: "经纬里还没有卷纲。请用 outline.volume(action=suggest) 生成草案给我确认，我确认后再 set。",
        label: "生成卷纲草案",
      };
    // 待确认事件属于故事脉络工作区的章后事实队列。
    case "review-pending":
      return { kind: "view", view: "storyline", label: "去处理待确认事件" };
    // 伏笔账本唯一入口在故事推进侧栏（就地渲染，不在工具区）。
    case "review-hooks":
      return { kind: "view", view: "storyline", label: "去查看伏笔账本" };
    // 判据是当前项目 `.novelfork/skills/` 的实际文件，唯一能改它的界面是
    // 「技能文风」视图里的写作技能面板（写作设置里已没有写作技能分区）。切「工具」视图只有诊断面板，改不了这项。
    case "enable-style":
      return { kind: "view", view: "skills-style", label: "启用写作技能" };
    case "adjust-word-target":
      return { kind: "view", view: "explorer", label: "调整章字数目标" };
    // preflight 的 currentFocus 来自 cockpit 的 readCurrentFocusFromJingwei，
    // 权威源是经纬 current-focus 创作罗盘（写作侧栏常驻），不是
    // story/current_focus.md。一键修应留在写作视图填罗盘，而不是跳去卷纲。
    case "open-focus":
      return { kind: "write-compass", label: "填写创作罗盘" };
    default:
      return { kind: "view", view: "tools", label: "查看详情" };
  }
}

/** 写章动作是否可用：directive 必须够长；仅 focus 默认句时需接受。 */
export function canStartWriting(input: {
  readonly model: WriteViewModel;
  readonly directiveDraft: string;
  readonly acceptFocusDefault: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const draft = input.directiveDraft.trim();
  if (!input.model.canWrite) {
    // 新书唯一缺的是本章方向：作者在下方写了够长的一句，就已补上这项，可以直接写。
    // 叙述者执行写章时会带着这句指示重新做写前检查。
    if (input.model.onboarding && draft.length >= 8) return { ok: true };
    if (input.model.onboarding) {
      return { ok: false, reason: draft.length > 0 ? "本章目标至少 8 字。" : "先按上面的提示补上本章方向，或在这里写一句本章要发生什么。" };
    }
    return { ok: false, reason: input.model.headline };
  }
  if (draft.length === 0) {
    if (!input.model.resolvedDirective) {
      return { ok: false, reason: "请先写一句本章目标。" };
    }
    if (input.model.needsUserConfirm && !input.acceptFocusDefault) {
      return { ok: false, reason: "当前只有焦点默认目标，请确认后再写。" };
    }
    return { ok: true };
  }
  if (draft.length < 8) {
    return { ok: false, reason: "本章目标至少 8 字。" };
  }
  return { ok: true };
}

/** 生成写章调用序列：scene.spec → pipeline.write。 */
export function buildWriteSequence(input: {
  readonly chapterNumber: number;
  readonly directive: string;
  readonly acceptFocusDefault: boolean;
  readonly preflight?: unknown;
}): Array<{ readonly tool: string; readonly input: Record<string, unknown> }> {
  return [
    {
      tool: "scene.spec",
      input: {
        chapterNumber: input.chapterNumber,
        userDirectives: input.directive,
        acceptFocusDefault: input.acceptFocusDefault,
        ...(input.preflight ? { writePreflight: input.preflight } : {}),
      },
    },
    { tool: "pipeline.write", input: { autoRevise: true } },
  ];
}
