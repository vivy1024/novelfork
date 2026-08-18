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
  | "outline-branch"
  | "polish"
  | "rewrite"
  | "naturalize"
  | "compress";

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

// ---- Polish ---------------------------------------------------------------

export interface PolishInput extends InlineWriteInput {
  mode: "polish";
}

export function buildPolishPrompt(
  input: PolishInput,
  context: InlineWriteContext,
): string {
  return [
    "# 文本润色任务",
    "你是一位中文网文写作助手。请对选中文本进行润色，优化文字表达，使其更加流畅优美，同时保持原意不变。",
    CONTEXT_BLOCK(context),
    `## 选中文本\n${input.selectedText}`,
    input.direction ? `## 润色方向\n${input.direction}` : "",
    "## 输出要求",
    "- 直接输出润色后的文本，将替换原文",
    "- 保持原意不变，仅优化表达方式",
    "- 保持文风与原文一致",
    "- 字数与原文接近（±20%）",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parsePolishResult(
  response: string,
  _input?: PolishInput,
): InlineWriteResult {
  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "polish",
  };
}

// ---- Rewrite --------------------------------------------------------------

export interface RewriteInput extends InlineWriteInput {
  mode: "rewrite";
}

export function buildRewritePrompt(
  input: RewriteInput,
  context: InlineWriteContext,
): string {
  return [
    "# 文本改写任务",
    "你是一位中文网文写作助手。请对选中文本进行改写，用全新的表述方式传达相同含义，使文字更有表现力。",
    CONTEXT_BLOCK(context),
    `## 选中文本\n${input.selectedText}`,
    input.direction ? `## 改写方向\n${input.direction}` : "",
    "## 输出要求",
    "- 直接输出改写后的文本，将替换原文",
    "- 含义保持不变，但用全新的表达方式",
    "- 保持文风与原文一致",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseRewriteResult(
  response: string,
  _input?: RewriteInput,
): InlineWriteResult {
  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "rewrite",
  };
}

// ---- Naturalize (人味化 / 去AI味) ------------------------------------------

export interface NaturalizeInput extends InlineWriteInput {
  mode: "naturalize";
}

export function buildNaturalizePrompt(
  input: NaturalizeInput,
  context: InlineWriteContext,
): string {
  return [
    "# 文本去AI味人味化任务",
    "你是一位资深中文网文润色专家。请对选中文本进行人味化改写，彻底清除AI生成痕迹，使文字回归真实母语质感与自然呼吸感。",
    CONTEXT_BLOCK(context),
    `## 需要去AI味的选中文本\n${input.selectedText}`,
    input.direction ? `## 额外指示\n${input.direction}` : "",
    "## 必须执行的去AI味硬规则",
    "1. 【打碎工整对仗】：打破连续相同长度的句子，制造长短错落。严禁连续3句句式对称。",
    "2. 【清除套词】：严禁使用「眼中闪过一丝」「嘴角勾起一抹」「深吸一口气」「不由自主」「心中暗道」「心头一震」「仿佛……一般」等典型AI套话。",
    "3. 【禁止议论式句式】：严禁使用「不是A，而是B」这类论文腔否定翻转句式，直接写后项或用动作呈现。",
    "4. 【情绪外化】：把抽象的「他感到紧张/愤怒/伤心」替换为具体的生理反应或现场动作（手心冒汗、把烟掐灭、半天没说话）。",
    "5. 【允许自然不完美】：适度保留母语习惯中的片段句（「行吧。」「算了。」）、语气词、口语重复和现场真实停顿，不要过度解释和面面俱到。",
    "6. 【严禁章末大升华】：不要在结尾做哲理性总结或感慨（如「这一刻他终于明白……」）。",
    "## 输出要求",
    "- 直接输出去AI味后的纯正文，将替换原文",
    "- 保持原文核心情节、人物动机和世界观设定完全不变",
    "- 字数与原文接近（±20%）",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseNaturalizeResult(
  response: string,
  _input?: NaturalizeInput,
): InlineWriteResult {
  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "naturalize",
  };
}

// ---- Compress (精简 / 脱水) ------------------------------------------------

export interface CompressInput extends InlineWriteInput {
  mode: "compress";
}

export function buildCompressPrompt(
  input: CompressInput,
  context: InlineWriteContext,
): string {
  return [
    "# 文本精简脱水任务",
    "你是一位中文网文编辑。请对选中文本进行精炼压缩，删除废话、冗余描写和过度解释，保留核心情节与关键张力。",
    CONTEXT_BLOCK(context),
    `## 需要精简的选中文本\n${input.selectedText}`,
    input.direction ? `## 额外指示\n${input.direction}` : "",
    "## 精简要求",
    "- 删掉冗余修饰词、套话副词和无意义动作清单",
    "- 删掉解释性旁白，留给读者从动作中理解",
    "- 压缩比例：压缩到原文的 50% - 70% 长度",
    "- 保留所有关键情节节点、信息变化和伏笔",
    "- 直接输出精简后的纯正文，将替换原文",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseCompressResult(
  response: string,
  _input?: CompressInput,
): InlineWriteResult {
  const content = response.trim();
  return {
    content,
    wordCount: content.length,
    mode: "compress",
  };
}

