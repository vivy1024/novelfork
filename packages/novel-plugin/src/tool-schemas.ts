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
  "presets.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。scope=enabled 时必填。"),
      scope: stringSchema("enabled=当前书籍已启用规则（含 promptInjection 全文）；available=全部可用预设（含 enabled 标记）。默认 enabled。"),
      category: stringSchema("scope=available 时可按分类过滤（可选）。"),
    },
    required: [],
    additionalProperties: false,
  },
  "presets.write": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("enable（启用）/disable（禁用）/set（覆盖启用列表）/create（创建自定义预设）。"),
      enabledPresetIds: arraySchema("enable/disable/set 时操作的预设 ID 列表。", { type: "string" }),
      name: stringSchema("action=create 时必填：预设名。"),
      category: stringSchema("action=create 时必填：分类（tone/genre/setting-base/logic-risk/anti-ai/literary）。"),
      promptInjection: stringSchema("action=create 时必填：注入到写作提示词的规则全文。"),
      description: stringSchema("action=create 时可选：描述。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
  "beat.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "beat.write": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("select（切换到已有模板）/create（创建自定义节拍模板）。"),
      templateId: stringSchema("action=select 时必填：模板 ID（如 opening-hooks、three-act、save-the-cat、heros-journey、chapter-ending-hooks）。"),
      name: stringSchema("action=create 时必填：节拍模板名。"),
      description: stringSchema("action=create 时必填：描述。"),
      beats: arraySchema("action=create 时必填：节拍序列，每项含 name/emotionalTone/wordRatio/purpose?/networkNovelTip?。"),
    },
    required: ["action"],
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
  "jingwei.audit": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      entryIds: arraySchema("可选：仅审计指定经纬条目 ID。", { type: "string" }),
      chapterNumber: numberSchema("可选：按指定章节检查可见性窗口。"),
    },
    required: ["bookId"],
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
      mode: stringSchema("写入模式：overwrite（覆盖，默认）、append（追加到已有内容末尾）。"),
      confirmCanonEdit: booleanSchema("修改 Canon 条目时必须设为 true 以确认修改"),
      reason: stringSchema("变更原因；写入 canon 或 rules 类静态设定时必填。"),
      source: stringSchema("设定来源；写入 canon 或 rules 类静态设定时需提供 source 或 evidence。"),
      evidence: stringSchema("证据摘录；写入 canon 或 rules 类静态设定时需提供 source 或 evidence。"),
      status: { type: "string", enum: ["draft", "confirmed", "needs-review"], description: "条目状态（默认 confirmed）" },
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
      jingweiBrief: { type: "object", description: "兼容旧字段：经纬/Lore 核心包摘要（可选）。新调用优先使用 loreBrief。" },
      loreBrief: { type: "object", description: "lore.read 返回的静态设定核心包（可选，用于提取角色、地点、世界观等设定）。" },
      memoryContext: { type: "object", description: "memory.read 返回的动态叙事记忆上下文（可选，用于时间线、伏笔、事实和角色状态约束）。" },
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
  "memory.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      purpose: stringSchema("动态叙事记忆召回目的：write | revise | audit | outline | diagnose。"),
      chapterNumber: numberSchema("目标章节序号（可选）。"),
      entities: arraySchema("关注实体列表（可选）。", { type: "string" }),
      sceneText: stringSchema("当前场景文本或写作意图（可选）。"),
      budgetTokens: numberSchema("总 token 预算（可选）。"),
      channels: arraySchema("召回通道（可选）：hard | state | timeline | hooks | facts | style。", { type: "string" }),
    },
    required: ["bookId", "purpose"],
    additionalProperties: false,
  },
  "memory.graph": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      view: stringSchema("动态图谱视图：relationship | timeline | character_arc | foreshadowing | conflict | event_chain | wave。"),
      focusEntity: stringSchema("聚焦实体（可选）。"),
      chapterRange: arraySchema("章节范围 [from, to]（可选）。", { type: "number" }),
    },
    required: ["bookId", "view"],
    additionalProperties: false,
  },
  "memory.events": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("Pending NarrativeEvents 操作：list | create | approve | reject。"),
      eventId: stringSchema("approve/reject 时的事件 ID。"),
      chapterNumber: numberSchema("create 时的章节序号。"),
      eventType: stringSchema("create 时的事件类型，如 character_state_changed | relationship_changed | hook_planted | timeline_advanced。"),
      subject: stringSchema("create 时的事件主体。"),
      predicate: stringSchema("create 时的事件谓词/关系。"),
      object: stringSchema("create 时的事件客体/状态。"),
      evidenceText: stringSchema("create 时的证据文本。"),
      confidence: numberSchema("create 时的置信度 0-1。"),
      layer: stringSchema("create 时的事实层：dynamic | canon | reference，默认 dynamic。"),
      reason: stringSchema("批准或拒绝原因（可选）。"),
      limit: numberSchema("list 返回数量上限（可选）。"),
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
  "resource.manage": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("list（列出正式章节结果）/archive（归档）/delete（删除）。"),
      resourceId: stringSchema("action 非 list 时必填：目标资源 ID。"),
      filter: { type: "object", description: "action=list 时可选过滤：{ type?: 'chapter', status?: 'accepted'|'archived' }。" },
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
};

NOVEL_TOOL_SCHEMAS["lore.read"] = NOVEL_TOOL_SCHEMAS["jingwei.read"]!;
NOVEL_TOOL_SCHEMAS["lore.write"] = NOVEL_TOOL_SCHEMAS["jingwei.write"]!;
