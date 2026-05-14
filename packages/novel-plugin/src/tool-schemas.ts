/**
 * Novel tool inputSchema definitions — the single source of truth for all 24 novel tool schemas.
 *
 * These schemas define the JSON Schema for each tool's input parameters.
 * Studio's session-tool-registry-novel.ts imports from here instead of defining inline.
 */

export type ToolInputSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};

function stringSchema(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function numberSchema(description: string): Record<string, unknown> {
  return { type: "number", description };
}

function booleanSchema(description: string): Record<string, unknown> {
  return { type: "boolean", description };
}

function arraySchema(description: string, items: Record<string, unknown> = { type: "object" }): Record<string, unknown> {
  return { type: "array", description, items };
}

/**
 * 24 个小说领域工具的 inputSchema 定义
 */
export const NOVEL_TOOL_SCHEMAS: Record<string, ToolInputSchema> = {
  "cockpit.get_snapshot": {
    type: "object",
    properties: {
      bookId: stringSchema("要读取快照的书籍 ID。"),
      includeModelStatus: booleanSchema("是否包含当前模型配置与工具支持状态。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "cockpit.list_open_hooks": {
    type: "object",
    properties: {
      bookId: stringSchema("要读取伏笔的书籍 ID。"),
      limit: numberSchema("最多返回的伏笔数量。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "cockpit.list_recent_candidates": {
    type: "object",
    properties: {
      bookId: stringSchema("要读取候选稿的书籍 ID。"),
      limit: numberSchema("最多返回的候选稿数量。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "questionnaire.list_templates": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID，用于筛选适用模板。"),
      purpose: stringSchema("本次问卷的目标或创作阶段。"),
    },
    required: [],
    additionalProperties: false,
  },
  "questionnaire.start": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      templateId: stringSchema("要启动的问卷模板 ID。"),
      goal: stringSchema("本次问卷要服务的创作目标。"),
    },
    required: ["bookId", "templateId"],
    additionalProperties: false,
  },
  "questionnaire.suggest_answer": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      templateId: stringSchema("问卷模板 ID。"),
      questionId: stringSchema("需要建议答案的问题 ID。"),
      providerId: stringSchema("用于生成建议的 provider ID。"),
      modelId: stringSchema("用于生成建议的 model ID。"),
      existingAnswers: { type: "object", description: "当前已填写的问卷答案。" },
      context: stringSchema("用户已提供的上下文或现有答案摘要。"),
    },
    required: ["bookId", "templateId", "questionId"],
    additionalProperties: false,
  },
  "questionnaire.submit_response": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      templateId: stringSchema("问卷模板 ID。"),
      responseId: stringSchema("问卷回答 ID。"),
      answers: { type: "object", description: "结构化问卷答案。" },
    },
    required: ["bookId", "templateId", "answers"],
    additionalProperties: false,
  },
  "pgi.generate_questions": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号。"),
      chapterIntent: stringSchema("本章写作意图或用户请求。"),
      maxQuestions: numberSchema("最多生成的问题数量。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "pgi.record_answers": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      questions: arraySchema("PGI 问题及触发原因列表。"),
      answers: arraySchema("PGI 问题回答列表。"),
      heuristicsTriggered: arraySchema("本轮触发的 PGI 启发式。"),
      skippedReason: stringSchema("跳过 PGI 时的原因。"),
    },
    required: ["bookId", "sessionId"],
    additionalProperties: false,
  },
  "pgi.format_answers_for_prompt": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      answers: arraySchema("PGI 问题回答列表。"),
      skippedReason: stringSchema("跳过 PGI 时的原因。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "guided.enter": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      goal: stringSchema("引导式生成目标。"),
      target: stringSchema("计划目标类型，例如 chapter-candidate、jingwei-update 或 audit。"),
      stateId: stringSchema("可选的引导式生成状态 ID，用于恢复测试或外部状态接入。"),
      questions: arraySchema("初始结构化问题列表。"),
      contextSources: arraySchema("已读取的上下文来源。"),
      answers: { type: "object", description: "已有引导式问题回答。" },
    },
    required: ["bookId", "sessionId", "goal"],
    additionalProperties: false,
  },
  "guided.answer_question": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      guidedStateId: stringSchema("引导式生成状态 ID。"),
      answers: { type: "object", description: "按问题 ID 记录的回答。" },
      skippedQuestionIds: arraySchema("被用户跳过的问题 ID。"),
    },
    required: ["bookId", "sessionId", "guidedStateId"],
    additionalProperties: false,
  },
  "guided.exit": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      sessionId: stringSchema("当前会话 ID。"),
      guidedStateId: stringSchema("引导式生成状态 ID。"),
      plan: { type: "object", description: "可供用户审查的 GuidedGenerationPlan。" },
    },
    required: ["bookId", "sessionId", "guidedStateId", "plan"],
    additionalProperties: false,
  },
  "candidate.create_chapter": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      chapterIntent: stringSchema("候选章节写作意图。"),
      chapterNumber: numberSchema("目标章节序号。"),
      title: stringSchema("候选章节标题。"),
      pgiInstructions: stringSchema("由 PGI 格式化得到的本章作者指示。"),
      guidedPlanId: stringSchema("关联的 GuidedGenerationPlan ID。"),
    },
    required: ["bookId", "chapterIntent"],
    additionalProperties: false,
  },
  "narrative.read_line": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      includeWarnings: booleanSchema("是否包含叙事线 warnings。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "narrative.propose_change": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      summary: stringSchema("叙事线变更摘要。"),
      nodes: arraySchema("拟新增或修改的叙事节点。"),
      edges: arraySchema("拟新增或修改的叙事边。"),
      reason: stringSchema("提出该变更的原因。"),
    },
    required: ["bookId", "summary"],
    additionalProperties: false,
  },
  "chapter.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("章节序号。"),
    },
    required: ["bookId", "chapterNumber"],
    additionalProperties: false,
  },
  "jingwei.read_context": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      categories: arraySchema("要读取的经纬栏目（可选，默认全部）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "health.read_summary": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "chapter.audit": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("章节序号。"),
      checks: arraySchema("要执行的检查项（可选，默认全部）。可选值: continuity, rhythm, ai_taste, hooks, character", { type: "string" }),
    },
    required: ["bookId", "chapterNumber"],
    additionalProperties: false,
  },
  "rewrite.segment": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("章节序号。"),
      selection: { type: "object", description: "选中行号范围 { start: number, end: number }。" },
      mode: stringSchema("改写模式：continue | expand | reduce_ai | restyle。"),
      styleHint: stringSchema("restyle 模式的风格提示（可选）。"),
      sessionId: stringSchema("当前会话 ID（用于获取模型配置）。"),
    },
    required: ["bookId", "chapterNumber", "selection", "mode"],
    additionalProperties: false,
  },
  "outline.suggest_next": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      sessionId: stringSchema("当前会话 ID（用于获取模型配置）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "character.check_consistency": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      characterName: stringSchema("角色名（可选，不传则检查所有角色）。"),
      chapterRange: { type: "object", description: "章节范围 { from: number, to: number }（可选，默认最近 5 章）。" },
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "hooks.manage": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("操作类型：plant | payoff | check_due | list。"),
      hookId: stringSchema("伏笔 ID（payoff 时需要）。"),
      chapterNumber: numberSchema("章节号（plant/check_due 时使用）。"),
      description: stringSchema("伏笔描述（plant 时需要）。"),
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
};
