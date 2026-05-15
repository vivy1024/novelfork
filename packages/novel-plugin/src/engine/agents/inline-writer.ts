// ---------------------------------------------------------------------------
// Inline Writer — 行内写作模式类型系统 + prompt 构建 / 结果解析
// ---------------------------------------------------------------------------

// ---- Types ----------------------------------------------------------------

export type InlineWriteMode =
  | "continuation"
  | "expansion"
  | "bridge"
  | "dialogue"
  | "variant"
  | "outline-branch";

export interface InlineWriteContext {
  bookId: string;
  chapterNumber: number;
  /** 光标前最后 3000 字 */
  beforeText: string;
  /** 光标后文本（可选） */
  afterText?: string;
  styleGuide?: string;
  bookRules?: string;
}

export interface InlineWriteInput {
  mode: InlineWriteMode;
  selectedText: string;
  direction?: string;
}

export interface InlineWriteResult {
  content: string;
  wordCount: number;
  mode: InlineWriteMode;
}

// ---- Continuation ---------------------------------------------------------

export interface ContinuationInput extends InlineWriteInput {
  mode: "continuation";
}

// ---- Expansion ------------------------------------------------------------

export type ExpansionDirection =
  | "sensory"
  | "action"
  | "psychology"
  | "environment"
  | "dialogue";

export interface ExpansionInput extends InlineWriteInput {
  mode: "expansion";
  expansionDirection: ExpansionDirection;
}

export interface ExpansionResult extends InlineWriteResult {
  originalWordCount: number;
  expandedWordCount: number;
  expansionRatio: number;
}

// ---- Bridge ---------------------------------------------------------------

export type BridgePurpose =
  | "scene-transition"
  | "time-skip"
  | "emotional-transition"
  | "suspense-setup";

export interface BridgeInput extends InlineWriteInput {
  mode: "bridge";
  purpose: BridgePurpose;
}

// ---------------------------------------------------------------------------
// Prompt builders & result parsers
// ---------------------------------------------------------------------------

const STYLE_SECTION = (ctx: InlineWriteContext) =>
  ctx.styleGuide ? `\n## 文风指南\n${ctx.styleGuide}` : "";

const RULES_SECTION = (ctx: InlineWriteContext) =>
  ctx.bookRules ? `\n## 书籍规则\n${ctx.bookRules}` : "";

const CONTEXT_BLOCK = (ctx: InlineWriteContext) =>
  [
    `## 上下文（第 ${ctx.chapterNumber} 章）`,
    `### 前文（最后 3000 字）\n${ctx.beforeText}`,
    ctx.afterText ? `### 后文\n${ctx.afterText}` : "",
    STYLE_SECTION(ctx),
    RULES_SECTION(ctx),
  ]
    .filter(Boolean)
    .join("\n\n");

// ---- Continuation ---------------------------------------------------------

export function buildContinuationPrompt(
  input: ContinuationInput,
  context: InlineWriteContext,
): string {
  return [
    "# 选段续写任务",
    "你是一位中文网文写作助手。请根据选中文本自然续写 500-1500 字，保持文风一致、情节连贯。",
    CONTEXT_BLOCK(context),
    `## 选中文本\n${input.selectedText}`,
    input.direction ? `## 续写方向\n${input.direction}` : "",
    "## 输出要求",
    "- 直接输出续写内容，不要包含任何标记或解释",
    "- 字数：500-1500 字",
    "- 保持人称、时态、文风与前文一致",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseContinuationResult(
  response: string,
  _input?: ContinuationInput,
): InlineWriteResult {
  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "continuation",
  };
}

// ---- Expansion ------------------------------------------------------------

const EXPANSION_DIRECTION_LABELS: Record<ExpansionDirection, string> = {
  sensory: "感官细节（视觉、听觉、嗅觉、触觉、味觉）",
  action: "动作描写（肢体语言、战斗细节、微表情）",
  psychology: "心理活动（内心独白、情绪波动、回忆联想）",
  environment: "环境描写（场景氛围、天气、光影、空间感）",
  dialogue: "对话扩展（增加对话轮次、潜台词、语气描写）",
};

export function buildExpansionPrompt(
  input: ExpansionInput,
  context: InlineWriteContext,
): string {
  const dirLabel = EXPANSION_DIRECTION_LABELS[input.expansionDirection];
  return [
    "# 场景扩写任务",
    `你是一位中文网文写作助手。请对选中文本进行「${dirLabel}」方向的扩写，使内容更加丰满生动。`,
    CONTEXT_BLOCK(context),
    `## 选中文本\n${input.selectedText}`,
    input.direction ? `## 额外指示\n${input.direction}` : "",
    `## 扩写方向\n${dirLabel}`,
    "## 输出要求",
    "- 直接输出扩写后的完整段落，替换原文",
    "- 扩写比例：1.5x - 3x",
    "- 保持原文核心情节不变，仅在指定方向上丰富细节",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseExpansionResult(
  response: string,
  input: ExpansionInput,
): ExpansionResult {
  const content = response.trim();
  const originalWordCount = input.selectedText.length;
  const expandedWordCount = content.length;
  return {
    content,
    wordCount: expandedWordCount,
    mode: "expansion",
    originalWordCount,
    expandedWordCount,
    expansionRatio:
      originalWordCount > 0 ? expandedWordCount / originalWordCount : 0,
  };
}

// ---- Bridge ---------------------------------------------------------------

const BRIDGE_PURPOSE_LABELS: Record<BridgePurpose, string> = {
  "scene-transition": "场景转换 — 从一个场景自然过渡到另一个场景",
  "time-skip": "时间跳跃 — 跳过一段时间，用简练笔触交代时间流逝",
  "emotional-transition": "情绪过渡 — 从一种情绪状态过渡到另一种",
  "suspense-setup": "悬念铺垫 — 在两段之间埋下伏笔或制造悬念",
};

export function buildBridgePrompt(
  input: BridgeInput,
  context: InlineWriteContext,
): string {
  const purposeLabel = BRIDGE_PURPOSE_LABELS[input.purpose];
  return [
    "# 段落补写任务",
    `你是一位中文网文写作助手。请在选中位置补写一段过渡文本，目的：${purposeLabel}。`,
    CONTEXT_BLOCK(context),
    `## 选中文本（补写位置）\n${input.selectedText}`,
    context.afterText
      ? ""
      : "注意：没有后文，补写内容将作为段落结尾。",
    input.direction ? `## 额外指示\n${input.direction}` : "",
    `## 补写目的\n${purposeLabel}`,
    "## 输出要求",
    "- 直接输出补写内容",
    "- 字数：200-800 字",
    "- 确保与前后文自然衔接",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseBridgeResult(
  response: string,
  _input?: BridgeInput,
): InlineWriteResult {
  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "bridge",
  };
}
