/**
 * Novel tool inputSchema definitions — the single source of truth for novel tool schemas.
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
 * 小说领域工具的 inputSchema 定义
 */
export const NOVEL_TOOL_SCHEMAS: Record<string, ToolInputSchema> = {
  "cockpit.snapshot": {
    type: "object",
    properties: {
      bookId: stringSchema("要读取快照的书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
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
  "pgi.ask": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号（可选）。"),
      chapterIntent: stringSchema("本章写作意图或用户请求（可选）。"),
      maxQuestions: numberSchema("最多生成的问题数量（可选）。"),
    },
    required: ["bookId"],
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
      sessionId: stringSchema("当前会话 ID。"),
      bookId: stringSchema("当前书籍 ID。"),
      goal: stringSchema("引导式生成要达成的目标。"),
      stateId: stringSchema("可选的引导状态 ID。"),
      questions: arraySchema("要向用户确认的引导问题列表。"),
      answers: { type: "object", description: "已有问题回答。" },
      contextSources: arraySchema("支撑本次引导的上下文来源列表。"),
    },
    required: ["sessionId", "bookId", "goal"],
    additionalProperties: false,
  },
  "guided.answer_question": {
    type: "object",
    properties: {
      guidedStateId: stringSchema("引导式生成状态 ID。"),
      answers: { type: "object", description: "本轮提交的问题回答。" },
      skippedQuestionIds: arraySchema("本轮跳过的问题 ID 列表。", { type: "string" }),
    },
    required: ["guidedStateId"],
    additionalProperties: false,
  },
  "guided.exit": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID，用于确认审计和目标资源定位。"),
      sessionId: stringSchema("当前会话 ID，用于确认审计。"),
      guidedStateId: stringSchema("引导式生成状态 ID。"),
      plan: { type: "object", description: "用户确认后的引导式生成计划。" },
    },
    required: ["guidedStateId", "plan"],
    additionalProperties: false,
  },
  "candidate.create_chapter": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      chapterIntent: stringSchema("候选章节写作意图。注意：本工具只保存已有正文；完整写下一章请使用 pipeline.generate_chapter。"),
      chapterNumber: numberSchema("目标章节序号。"),
      title: stringSchema("候选章节标题。"),
      pgiInstructions: stringSchema("由 PGI 格式化得到的本章作者指示。"),
      content: stringSchema("已有的完整章节候选稿正文。本工具不会生成正文、不会审计、不会修订、不会同步经纬；完整写下一章请调用 pipeline.generate_chapter。"),
    },
    required: ["bookId", "chapterIntent", "content"],
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
  "chapter.list": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "jingwei.read_brief": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("当前章节号（用于章节可见性过滤，可选）。"),
      sceneText: stringSchema("当前场景文本（用于 tracked 条目匹配与推荐读取，可选）。"),
      chapterIntent: stringSchema("本章写作意图或当前任务目标（用于优先挑选核心包内容，可选）。"),
      tokenBudget: numberSchema("核心包 token 预算，默认 4000。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "jingwei.read_category": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      category: stringSchema("要读取的经纬分类，如 characters、world-model、foreshadowing、chapter-summaries。"),
      chapterNumber: numberSchema("当前章节号（用于章节可见性过滤，可选）。"),
      sceneText: stringSchema("当前场景文本（用于相关性排序，可选）。"),
      page: numberSchema("分页页码，默认 1。"),
      limit: numberSchema("每页最多条目数，默认 20。"),
      tokenBudget: numberSchema("本次分类读取 token 预算。"),
      detailLevel: stringSchema("详情等级：summary | normal | full，默认 summary。"),
    },
    required: ["bookId", "category"],
    additionalProperties: false,
  },
  "jingwei.search": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      query: stringSchema("搜索关键词，可为角色名、别名、标签、地点或设定关键词。"),
      categories: arraySchema("限制搜索的经纬分类列表（可选）。", { type: "string" }),
      chapterNumber: numberSchema("当前章节号（用于章节可见性过滤，可选）。"),
      tokenBudget: numberSchema("搜索结果 token 预算。"),
      limit: numberSchema("最多返回条目数，默认 20。"),
    },
    required: ["bookId", "query"],
    additionalProperties: false,
  },
  "jingwei.read_context": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。兼容工具：默认返回核心包 + 目录摘要；新流程请优先使用 jingwei.read_brief。"),
      categories: arraySchema("要读取的经纬分类（可选）。新流程请改用 jingwei.read_category。"),
      chapterNumber: numberSchema("当前章节号（用于 visibleAfterChapter 过滤，可选）。"),
      sceneText: stringSchema("当前场景文本（用于 tracked 条目匹配，可选）。"),
      mode: stringSchema("上下文模式：auto/core/relevant/full。注意 full 不再表示无界全量读取，会返回目录与分页建议。"),
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
      content: stringSchema("章节正文（可选，不传则自动读取已保存章节）。"),
      sceneSpec: { type: "object", description: "Scene Spec 蓝图（可选，用于检查约束满足度）。" },
      canonEntries: arraySchema("Canon 层条目列表（可选，用于 H2 canon violation 检查）。"),
      povCharacter: stringSchema("当前 POV 角色名（可选，用于 H7 POV violation 检查）。"),
      wordTarget: numberSchema("目标字数（可选，用于 S1 字数范围检查）。"),
      checks: arraySchema("要执行的检查项（可选，默认全部）。可选值: continuity, rhythm, ai_taste, hooks, character, canon, pov", { type: "string" }),
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
  "rewrite.apply": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("章节序号。"),
      lineRange: { type: "object", description: "行号范围 { start: number, end: number }。" },
      newText: stringSchema("替换内容。"),
      mode: stringSchema("写入模式：replace（替换选中行，默认）、insert_after（在选中行后插入）。"),
    },
    required: ["bookId", "chapterNumber", "lineRange", "newText"],
    additionalProperties: false,
  },
  "style.get_profile": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "style.import": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      referenceText: stringSchema("参考文本（至少 2000 字）。"),
      sourceName: stringSchema("参考来源名称（可选，如「耳根《仙逆》」）。"),
    },
    required: ["bookId", "referenceText"],
    additionalProperties: false,
  },
  "pipeline.revise": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("章节序号（不填则修订最新章）。"),
      mode: stringSchema("修订模式：polish（润色，默认）、rewrite（重写）、rework（大改）、spot-fix（定点修复）、anti-detect（去AI味）。"),
      sessionId: stringSchema("当前会话 ID（用于获取模型配置）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "pipeline.import_chapters": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      filePath: stringSchema("服务器上的文件路径（.txt/.md）。"),
      splitPattern: stringSchema("章节分割正则（可选，默认匹配「第X章」「Chapter X」等）。"),
      maxChapters: numberSchema("最大导入章数（可选，默认 500）。"),
    },
    required: ["bookId", "filePath"],
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
      action: stringSchema("操作类型：plant | payoff | check_due | list | delete。"),
      hookId: stringSchema("伏笔 ID（payoff/delete 时需要）。"),
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
      mode: stringSchema("操作模式：set（覆盖全部，默认）、add（追加）、remove（移除）。"),
      enabledPresetIds: arraySchema("预设 ID 列表。set 模式=完整列表；add 模式=要追加的 ID；remove 模式=要移除的 ID。", { type: "string" }),
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
  "presets.list_available": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID（可选，传入时标注哪些已启用）。"),
      category: stringSchema("按分类筛选（可选）：genre / tone / setting-base / logic-risk / anti-ai / literary / bundle / custom。"),
    },
    required: [],
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
  "pipeline.write": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      sceneSpec: { type: "object", description: "由 scene.spec 工具生成的结构化写作蓝图。必须包含 scenes 数组，每个 scene 有 characters/location/conflict/outcome。" },
      jingweiContext: stringSchema("按 scene spec 补读的经纬上下文文本（可选）。"),
      previousChapterTail: stringSchema("前一章末尾 500 字（可选，用于衔接）。"),
      autoRevise: booleanSchema("是否自动修订审计不过的 critical 问题。默认 true。"),
    },
    required: ["bookId", "sceneSpec"],
    additionalProperties: false,
  },
  "pipeline.generate_chapter": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      chapterIntent: stringSchema("章节写作意图/方向描述。基于 cockpit 快照、用户回答和 PGI 结果组装。"),
      userDirectives: stringSchema("用户对 PGI 问题的回答，格式化后的本章作者指示。PGI 无问题时应包含 skippedReason=no-questions。"),
      wordCount: numberSchema("目标字数。不传则使用书籍默认配置。"),
      autoRevise: booleanSchema("是否自动修订审计不过的 critical 问题。默认 true。"),
    },
    required: ["bookId", "chapterIntent"],
    additionalProperties: false,
  },
  "jingwei.upsert_entry": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      category: stringSchema("经纬类别：character/event/worldview/power-system/geography/faction/item/skill/currency/special/outline/relationship/foreshadowing/plot/timeline/chapter-summary。"),
      title: stringSchema("条目标题（用于匹配已有条目，标题相同则更新）。"),
      contentMd: stringSchema("条目内容（Markdown 格式）。"),
      summaryMd: stringSchema("条目短摘要（可选；用于经纬核心包和分类目录化读取，未提供时自动截断生成）。"),
      aliases: arraySchema("别名列表（用于 tracked 可见性匹配）。"),
      tags: arraySchema("标签列表。"),
      visibility: stringSchema("可见性规则：global（始终注入）/ tracked（匹配时注入）/ nested（被关联时注入）。默认 tracked。"),
      relatedEntryIds: arraySchema("关联条目 ID 列表。"),
    },
    required: ["bookId", "category", "title", "contentMd"],
    additionalProperties: false,
  },
  "jingwei.write": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("操作类型：create（创建）| update（更新）| delete（删除）。默认根据标题自动判断创建或更新。"),
      title: stringSchema("条目标题（用于匹配已有条目，标题相同则更新）。"),
      contentMd: stringSchema("条目内容（Markdown 格式）。delete 时不需要。"),
      summaryMd: stringSchema("条目短摘要（可选；未提供时自动截断生成）。"),
      category: stringSchema("经纬类别。"),
      layer: stringSchema("数据层：canon（不可变真相）| dynamic（每章可更新）| reference（按需查阅）。默认 dynamic。"),
      aliases: arraySchema("别名列表。"),
      tags: arraySchema("标签列表。"),
      visibility: stringSchema("可见性规则：global | tracked | nested。默认 tracked。"),
      relatedEntryIds: arraySchema("关联条目 ID 列表。"),
      entryId: stringSchema("条目 ID（delete 时可用，按 ID 精确删除）。"),
      fields: { type: "object", description: "结构化元数据字段（可选，如 { locationType: '城市', grade: '灵品' }）。" },
      mode: stringSchema("写入模式：overwrite（覆盖，默认）、append（追加到已有内容末尾）。"),
    },
    required: ["bookId", "title"],
    additionalProperties: false,
  },
  "scene.spec": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号。"),
      userDirectives: stringSchema("用户对本章的写作指示/方向描述。"),
      cockpitSnapshot: { type: "object", description: "驾驶舱快照（可选，用于提取进度、伏笔、风险等上下文）。" },
      jingweiBrief: { type: "object", description: "经纬核心包摘要（可选，用于提取角色、地点、世界观等设定）。" },
    },
    required: ["bookId", "chapterNumber", "userDirectives"],
    additionalProperties: false,
  },
  "jingwei.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      scope: stringSchema("读取范围：brief（默认，核心包+目录）| category（分类读取）| search（搜索）。"),
      category: stringSchema("scope=category 时必填，要读取的经纬分类。"),
      query: stringSchema("scope=search 时必填，搜索关键词。"),
      chapterNumber: numberSchema("当前章节号（可选）。"),
      sceneText: stringSchema("当前场景文本（可选，用于相关性排序）。"),
      chapterIntent: stringSchema("本章写作意图（可选，用于核心包优先选择）。"),
      tokenBudget: numberSchema("token 预算（可选）。"),
      detailLevel: stringSchema("详情等级：summary | normal | full，默认 summary。"),
      page: numberSchema("分页页码（scope=category 时可用）。"),
      limit: numberSchema("每页条目数（scope=category/search 时可用）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
};
