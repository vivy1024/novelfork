/**
 * 诊断人话层 —— 所有拦截/告警都必须给出「发生了什么 / 为什么要看 / 建议怎么做」。
 *
 * 纪律：前端与叙述者不得按 code 自造文案，一律读 explanation。
 * 参考 neuro-book WorldIssue：code 只用于去重与统计，展示走结构化解释。
 */

export interface DiagnosticExplanation {
  /** 客观发生了什么（不带评价） */
  readonly whatHappened: string;
  /** 为什么值得关注（影响什么） */
  readonly whyItMatters: string;
  /** 建议的下一步动作（具体到工具或操作） */
  readonly suggestedAction: string;
}

export interface ExplainedDiagnostic<TCode extends string = string> {
  readonly code: TCode;
  readonly message: string;
  readonly explanation: DiagnosticExplanation;
  /** persistent=数据层问题，修好前会反复出现；advisory=一次性提醒 */
  readonly kind: "persistent" | "advisory";
}

type ExplanationTemplate = DiagnosticExplanation & { readonly kind: ExplainedDiagnostic["kind"] };

/** 写前硬门与告警的解释表。 */
const PREFLIGHT_EXPLANATIONS: Record<string, ExplanationTemplate> = {
  "missing-directive": {
    kind: "persistent",
    whatHappened: "本次没有拿到可用的本章目标：既没有用户一句指示，经纬里也没有可用的 currentFocus/大纲。",
    whyItMatters: "没有明确目标时，模型只能靠猜或用写作理论填字数，写出来的章节大概率跑偏且难修。",
    suggestedAction: "给一句本章要发生什么（≥8 字），或先在经纬写 focus/大纲后重试 write.preflight。",
  },
  "empty-recent-progress": {
    kind: "persistent",
    whatHappened: "这本书已有正式章节，但近章摘要与时间线记忆都是空的。",
    whyItMatters: "写手看不到前文事实，会自行编造前情，导致与已发布章节冲突。",
    suggestedAction: "先 memory.settle_range 或 book.dissect(settle=true) 回填近章记忆；若这些章是废稿则用 chapter.discard_range。",
  },
  "high-risk-pending": {
    kind: "persistent",
    whatHappened: "存在高风险的待确认叙事事件（pending NarrativeEvents）。",
    whyItMatters: "这些事件尚未成为可信事实；若直接续写，可能把未确认设定当既定事实用。",
    suggestedAction: "在叙事记忆面板或 memory.events 里逐条批准/拒绝后再写。",
  },
  "book-not-found": {
    kind: "persistent",
    whatHappened: "无法读取当前书籍的驾驶舱数据。",
    whyItMatters: "缺少书籍元数据时无法判断进度、卷纲与平台，写前检查不可信。",
    suggestedAction: "确认书籍绑定正常；必要时在「我的作品」重新校验 Runtime 绑定。",
  },
  "style-disabled": {
    kind: "advisory",
    whatHappened: "本书没有启用任何 Writing Skills，style 通道为空。",
    whyItMatters: "缺少文风约束时，语言容易向模型默认腔调漂移，出现 AI 味。",
    suggestedAction: "用 style.import 从参考文导入文风，或在 Writing Skills 面板启用 1–2 个技法。",
  },
  "hooks-overdue": {
    kind: "advisory",
    whatHappened: "有到期或临近到期的伏笔尚未处理。",
    whyItMatters: "长期悬置的伏笔会让读者感到承诺未兑现；越拖越难自然回收。",
    suggestedAction: "在本章安排推进或兑现，或在经纬 foreshadowing 里更新其状态与期限。",
  },
  "volume-focus-missing": {
    kind: "advisory",
    whatHappened: "经纬 outline 中没有设置卷纲。",
    whyItMatters: "缺少本卷目标时，中盘容易失去方向，章节各自为战。",
    suggestedAction: "用 outline.volume(action=suggest) 生成草案，确认后 action=set 写入经纬。",
  },
  "volume-range-drift": {
    kind: "advisory",
    whatHappened: "要写的章号不在当前卷的章号区间内。",
    whyItMatters: "卷纲与实际进度已脱节。带着错卷的目标写下去，本章会服务于错误的主线，卷末收束时对不上；pipeline.write 会以 volume-range-violation 直接拦下，这一次生成会白跑。",
    suggestedAction: "用 outline.volume 把覆盖该章号的卷设为 active，或修正卷区间后再写。",
  },
  "platform-target-mismatch": {
    kind: "advisory",
    whatHappened: "本书设定的章目标字数不在目标平台的建议区间内。",
    whyItMatters: "章长明显偏离平台习惯会影响读者留存与推荐表现。",
    suggestedAction: "在书籍设置里调整 chapterWordCount，或改用更匹配的平台设置。",
  },
  "short-directive": {
    kind: "advisory",
    whatHappened: "本章指示过短，不足以约束写作方向。",
    whyItMatters: "太短的指示等于没有目标，模型会自行补足意图。",
    suggestedAction: "补一句具体的本章目标：谁、要做什么、结果指向哪。",
  },
  "focus-default-only": {
    kind: "advisory",
    whatHappened: "本次没有用户指示，已用 currentFocus 生成了默认目标。",
    whyItMatters: "默认目标可能与你当下的意图不同，写完再改成本更高。",
    suggestedAction: "确认这个默认目标，或补一句自己的指示；接受默认时传 acceptFocusDefault=true。",
  },
  "empty-chapter-summary": {
    kind: "advisory",
    whatHappened: "经纬 chapter-summaries 为空。",
    whyItMatters: "写前只能依赖叙事记忆事件，前情颗粒度更粗。",
    suggestedAction: "用 book.dissect(apply=true) 或章后结算补齐章摘要。",
  },
  "audit-stale": {
    kind: "advisory",
    whatHappened: "有章节在审计之后又被修改过，现有审计结论已经不对应当前正文。",
    whyItMatters: "那些章显示「审计通过」，但结论是对修改前的正文得出的，问题可能仍然存在。",
    suggestedAction: "对这些章重新跑 chapter.audit，再据新结论决定是否修订。",
  },
};

const FALLBACK: ExplanationTemplate = {
  kind: "advisory",
  whatHappened: "检测到一个需要关注的问题。",
  whyItMatters: "它可能影响本章的连续性或发布合规。",
  suggestedAction: "查看详情信息并按提示处理；不确定时可先运行 write.preflight 或 publish.check。",
};

/** 按 code 取解释；未登记的 code 返回兜底解释而不是空。 */
export function explainDiagnostic<TCode extends string>(
  code: TCode,
  message: string,
): ExplainedDiagnostic<TCode> {
  const template = PREFLIGHT_EXPLANATIONS[code] ?? FALLBACK;
  return {
    code,
    message,
    kind: template.kind,
    explanation: {
      whatHappened: template.whatHappened,
      whyItMatters: template.whyItMatters,
      suggestedAction: template.suggestedAction,
    },
  };
}

/** 该 code 是否已登记解释（供契约测试使用）。 */
export function hasDiagnosticExplanation(code: string): boolean {
  return code in PREFLIGHT_EXPLANATIONS;
}

/** 已登记的全部 code。 */
export function listExplainedDiagnosticCodes(): string[] {
  return Object.keys(PREFLIGHT_EXPLANATIONS);
}

/** 叙事事件风险等级 → 解释（供 memory pending 展示）。 */
export function explainNarrativeEventRisk(input: {
  readonly riskLevel: string;
  readonly eventType: string;
  readonly chapterNumber: number;
}): ExplainedDiagnostic {
  const high = input.riskLevel === "high";
  return {
    code: `narrative-event-${input.riskLevel}`,
    message: `第${input.chapterNumber}章的 ${input.eventType} 事件（风险 ${input.riskLevel}）待确认。`,
    kind: high ? "persistent" : "advisory",
    explanation: {
      whatHappened: `章后结算从第${input.chapterNumber}章抽出一条 ${input.eventType} 事件，风险等级 ${input.riskLevel}，尚未沉淀为事实。`,
      whyItMatters: high
        ? "高风险事件可能改写世界规则或人物设定；未确认就被当事实使用会造成后续大范围冲突。"
        : "未确认事件不会进入写作上下文，相关信息在续写时可能缺失。",
      suggestedAction: high
        ? "核对正文证据后批准或拒绝；若判断有误可直接拒绝并手工补写正确事实。"
        : "确认无误后批准即可，或批量批准同类低风险事件。",
    },
  };
}
