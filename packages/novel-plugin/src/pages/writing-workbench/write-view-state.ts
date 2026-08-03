/**
 * 写作视图状态 —— 把 write.preflight 的结构化结果翻译成一屏可读的「就绪条」。
 *
 * 纯逻辑，无 React 依赖，便于单测。
 * 纪律：文案一律来自 preflight 的 explanation（人话三段式），此处不按 code 造词。
 */

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
}

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
 * book.json 的 `enabledWritingSkillIds`（见 write-preflight），对应界面是
 * Writing Skills 面板；旧「文风预设」（enabledPresetIds）已迁移下线，
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
  "style-disabled": { label: "Writing Skills", fixAction: "enable-style" },
  "volume-focus-missing": { label: "卷纲", fixAction: "set-volume" },
  "platform-target-mismatch": { label: "平台字数", fixAction: "adjust-word-target" },
  "book-not-found": { label: "书籍绑定" },
};

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
    label: meta?.label ?? code,
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
export function buildWriteViewModel(preflight: unknown): WriteViewModel {
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
  const checks = [
    ...passedChecks({
      hasDirective: Boolean(resolvedDirective),
      hasRecentMemory: recentChapters.length > 0,
      codes,
    }),
    ...blockers,
    ...warnings,
  ];

  const volume = record.currentVolume as { title?: unknown; goal?: unknown } | null | undefined;
  const volumeTitle = text(volume?.title);
  const volumeGoal = text(volume?.goal);
  const platform = record.platform as { label?: unknown; chapterTargetStatus?: unknown } | null | undefined;

  const chapterNumber = Number(record.chapterNumber);
  const light: ReadyLight = ok ? (warnings.length > 0 ? "yellow" : "green") : "red";
  const headline = ok
    ? warnings.length > 0
      ? `可以开写第 ${chapterNumber} 章，有 ${warnings.length} 条提醒。`
      : `可以开写第 ${chapterNumber} 章。`
    : blockers[0]?.message
      ?? "写前上下文未就绪，请先处理阻断项。";

  return {
    light,
    canWrite: ok,
    chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : 0,
    resolvedDirective,
    needsUserConfirm: record.needsUserConfirm === true,
    volumeLabel: volumeTitle ? (volumeGoal ? `${volumeTitle} · ${volumeGoal}` : volumeTitle) : null,
    platformLabel: text(platform?.label) || null,
    recentChapters,
    checks,
    headline,
  };
}

/**
 * 一键修动作 → 下一步怎么走。
 *
 * 纪律：任何会写入的修复都必须经叙述者与 Runtime 权限确认（kind="narrator"），
 * 前端不得静默 POST 写数据；只有导航类动作（view / settings / lore-panel）
 * 才由前端直接完成。
 *
 * 导航目标必须与 preflight 的判据同源，否则作者点完按钮改了东西、重跑
 * preflight 却发现问题还在。参见 CHECK_META 上方注释。
 */
export interface FixActionPlan {
  readonly kind: "narrator" | "view" | "settings" | "lore-panel";
  /** kind=narrator 时发给叙述者的请求文本 */
  readonly message?: string;
  /** kind=view 时要切到的侧栏视图 */
  readonly view?: "jingwei" | "tools" | "explorer";
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
    // 待确认事件在经纬工作区的「进度」分区
    case "review-pending":
      return { kind: "view", view: "jingwei", label: "去处理待确认事件" };
    case "review-hooks":
      return { kind: "view", view: "tools", label: "查看伏笔看板" };
    // 判据是 book.json 的 enabledWritingSkillIds，唯一能改它的界面是
    // 写作设置里的 Writing Skills 面板。切「工具」视图只有诊断面板，改不了这项。
    case "enable-style":
      return { kind: "settings", settingsSection: "writing-skills", label: "启用 Writing Skills" };
    case "adjust-word-target":
      return { kind: "view", view: "explorer", label: "调整章字数目标" };
    // preflight 的 currentFocus 来自 cockpit 的 readCurrentFocusFromJingwei，
    // 查的是经纬 SQLite（category IN focus/current-focus/outline），不是
    // story/current_focus.md —— 那个 md 只在 pipeline.write 注入上下文时读，
    // 改它不会让 missing-directive 消失。所以这里落到经纬 outline 分类。
    case "open-focus":
      return { kind: "lore-panel", loreCategory: "outline", label: "编辑卷纲/当前焦点" };
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
