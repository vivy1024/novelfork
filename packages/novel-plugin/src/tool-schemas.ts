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
  "candidate.create_chapter": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      chapterIntent: stringSchema("候选章节写作意图。"),
      chapterNumber: numberSchema("目标章节序号。"),
      title: stringSchema("候选章节标题。"),
      pgiInstructions: stringSchema("由 PGI 格式化得到的本章作者指示。"),
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
      chapterNumber: numberSchema("当前章节号（用于 visibleAfterChapter 过滤，可选）。"),
      sceneText: stringSchema("当前场景文本（用于 tracked 条目匹配，可选）。"),
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
  "presets.get_rules": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "presets.check_compliance": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      content: stringSchema("要检查的章节内容文本。"),
      chapterNumber: numberSchema("章节序号（可选，用于上下文）。"),
    },
    required: ["bookId", "content"],
    additionalProperties: false,
  },
  "beat.get_current": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "beat.set_template": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      templateId: stringSchema("节拍模板 ID（如 opening-hooks、three-act、save-the-cat、heros-journey、chapter-ending-hooks）。"),
    },
    required: ["bookId", "templateId"],
    additionalProperties: false,
  },
  "presets.set_rules": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      enabledPresetIds: arraySchema("要启用的预设 ID 列表。传空数组表示清空所有预设。", { type: "string" }),
    },
    required: ["bookId", "enabledPresetIds"],
    additionalProperties: false,
  },
  "presets.create_custom": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID（绑定到特定书籍，不传则为全局预设）。"),
      name: stringSchema("预设名称（如「禁止修为暴涨」「对话必须带方言」）。"),
      category: stringSchema("分类：anti-ai / literary / logic-risk / tone / setting-base / custom。"),
      promptInjection: stringSchema("注入到写作 prompt 中的规则文本。这是预设的核心内容。"),
      description: stringSchema("预设的简短描述（可选）。"),
    },
    required: ["name", "category", "promptInjection"],
    additionalProperties: false,
  },
  "beat.create_custom": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID（绑定到特定书籍，不传则为全局模板）。"),
      name: stringSchema("模板名称（如「凡人修仙四阶段」「日常渐变结构」）。"),
      description: stringSchema("模板描述。"),
      beats: arraySchema("节拍列表，每个节拍包含 name、emotionalTone、wordRatio、purpose 字段。", {
        type: "object",
        properties: {
          name: { type: "string", description: "节拍名称" },
          emotionalTone: { type: "string", description: "情绪基调" },
          wordRatio: { type: "number", description: "字数占比（0-1之间，所有节拍加起来应为1）" },
          purpose: { type: "string", description: "节拍目的" },
          networkNovelTip: { type: "string", description: "网文写作提示（可选）" },
        },
        required: ["name", "emotionalTone", "wordRatio", "purpose"],
      }),
    },
    required: ["name", "description", "beats"],
    additionalProperties: false,
  },
  "jingwei.upsert_entry": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      category: stringSchema("经纬类别：character/event/worldview/power-system/geography/faction/item/skill/currency/special/outline/relationship/foreshadowing/plot/timeline/chapter-summary。"),
      title: stringSchema("条目标题（用于匹配已有条目，标题相同则更新）。"),
      contentMd: stringSchema("条目内容（Markdown 格式）。"),
      aliases: arraySchema("别名列表（用于 tracked 可见性匹配）。"),
      tags: arraySchema("标签列表。"),
      visibility: stringSchema("可见性规则：global（始终注入）/ tracked（匹配时注入）/ nested（被关联时注入）。默认 tracked。"),
      relatedEntryIds: arraySchema("关联条目 ID 列表。"),
    },
    required: ["bookId", "category", "title", "contentMd"],
    additionalProperties: false,
  },
};
