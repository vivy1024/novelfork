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

function enumSchema(values: readonly string[], description: string): Record<string, unknown> {
  return { type: "string", enum: values, description };
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

const memoryKindSchema = enumSchema(["fact", "event", "log", "vector"], "条目类型：fact | event | log | vector。");
const writableMemoryKindSchema = enumSchema(["fact", "event"], "条目类型：仅支持 fact | event。");
const eventStatusSchema = enumSchema(["pending", "applied", "rejected"], "事件状态：pending | applied | rejected。");
const factLayerSchema = enumSchema(["canon", "dynamic", "reference"], "事实层：canon | dynamic | reference。");
const jsonFormatSchema = enumSchema(["json"], "导出格式：json（当前仅支持 json）。");
const memoryFilterSchema = {
  type: "object",
  description: "过滤条件：ids/status/layer/category/chapterRange/query。不同 kind 只接受适用字段。",
  properties: {
    ids: arraySchema("条目 ID 列表。", { type: "string" }),
    status: eventStatusSchema,
    layer: factLayerSchema,
    category: stringSchema("事实 category 或事件 eventType。"),
    chapterRange: arraySchema("章节范围 [from, to]。", { type: "number" }),
    query: stringSchema("关键词过滤。"),
  },
  additionalProperties: false,
};

const acknowledgedSkillsSchema = arraySchema(
  "兼容字段：可记录模型希望采用的相关技能名称。不参与任何门禁——技能是否生效由章节保存前对成品的合规校验判定（writing-skills.check_compliance），不由此字段判定。",
  {
    type: "object",
    properties: {
      slug: stringSchema("技能 slug（可选）。"),
      name: stringSchema("技能名称（可选）。"),
      quote: stringSchema("兼容旧客户端的引用字段，不参与门禁。"),
    },
    required: [],
    additionalProperties: false,
  },
);

const lineRangeSchema = {
  type: "object",
  properties: {
    start: numberSchema("起始行号（从 1 开始）。"),
    end: numberSchema("结束行号（包含）。"),
  },
  required: ["start", "end"],
  additionalProperties: false,
};

const chapterRangeSchema = {
  type: "object",
  properties: {
    from: numberSchema("起始章节号（包含）。"),
    to: numberSchema("结束章节号（包含）。"),
  },
  additionalProperties: false,
};

const sceneSpecSchema = {
  type: "object",
  description: "由 scene.spec 生成的结构化写作蓝图。",
  properties: {
    chapter: numberSchema("目标章节号。"),
    title: stringSchema("章节标题。"),
    wordTarget: numberSchema("目标字数。"),
    beatBudget: arraySchema("情节点字数预算：密点展开、疏点带过，总和需覆盖整章。", {
      type: "object",
      properties: {
        summary: stringSchema("这一拍具体发生什么。"),
        density: enumSchema(["dense", "normal", "sparse"], "情节点密度。"),
        words: numberSchema("分配字数。"),
        function: stringSchema("功能标签（可选）。"),
      },
      required: ["summary", "density", "words"],
      additionalProperties: false,
    }),
    scenes: arraySchema("场景列表。", {
      type: "object",
      properties: {
        characters: arraySchema("出场角色。", { type: "string" }),
        location: stringSchema("具体地点。"),
        conflict: stringSchema("核心冲突。"),
        mood: stringSchema("情绪基调。"),
        outcome: stringSchema("场景结果。"),
        hooks_used: arraySchema("回收的伏笔。", { type: "string" }),
        hooks_planted: arraySchema("新增的伏笔。", { type: "string" }),
      },
      required: ["characters", "location", "conflict", "outcome"],
      additionalProperties: false,
    }),
    constraints: arraySchema("写作约束。", { type: "string" }),
  },
  required: ["chapter", "title", "wordTarget", "scenes", "constraints"],
  additionalProperties: false,
};

/**
 * 小说领域工具的 inputSchema 定义
 */
export const NOVEL_TOOL_SCHEMAS: Record<string, ToolInputSchema> = {
  "cockpit.snapshot": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID（宿主注入；模型勿伪造）。"),
    },
    required: [],
    additionalProperties: false,
  },
  "write.preflight": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID（宿主注入；模型勿伪造）。"),
      chapterNumber: numberSchema("目标章节序号（可选，默认下一章）。"),
      userDirectives: stringSchema("用户一句本章写作指示（可选；空时尝试用 currentFocus 生成默认句）。"),
      acceptFocusDefault: booleanSchema("仅有 focus 默认目标时是否接受继续（默认 false，会 needsUserConfirm）。"),
      acknowledgedSkills: acknowledgedSkillsSchema,
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "memory.settle_range": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      fromChapter: numberSchema("起始章节（含）。"),
      toChapter: numberSchema("结束章节（含）。"),
      source: enumSchema(["accepted-resources", "chapter-files"], "正文来源：accepted-resources（默认，正式资源优先）| chapter-files。"),
      dryRun: booleanSchema("只扫描可结算章节，不写入记忆。默认 false。"),
    },
    required: ["bookId", "fromChapter", "toChapter"],
    additionalProperties: false,
  },
  "memory.settle_chapter": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("要结算的章节号；该章正文必须已落盘。"),
      title: stringSchema("章节标题，仅用于结算记录展示。"),
    },
    required: ["bookId", "chapterNumber"],
    additionalProperties: false,
  },
  "chapter.discard_range": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      fromChapter: numberSchema("起始章节（含）。"),
      toChapter: numberSchema("结束章节（含）。"),
      confirm: booleanSchema("必须为 true，确认整段丢弃。"),
      deleteMemory: booleanSchema("是否清除范围内 narrative events/facts（默认 true）。"),
      resetHooks: enumSchema(["untouched", "planned-only", "none"], "伏笔重置：untouched（默认，归档范围内伏笔）| planned-only | none。"),
      hardDelete: booleanSchema("true 时尽量物理删除章节文件；默认 false 仅归档。"),
    },
    required: ["bookId", "fromChapter", "toChapter", "confirm"],
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
      removeNodeIds: arraySchema("拟删除的作者叙事节点 ID；章节/经纬等派生节点无法删除。", { type: "string" }),
      removeEdgeIds: arraySchema("拟删除的作者叙事边 ID。", { type: "string" }),
      reason: stringSchema("提出该变更的原因。"),
    },
    required: ["bookId", "summary"],
    additionalProperties: false,
  },
  "narrative.approve_change": {
    type: "object",
    properties: {
      bookId: stringSchema("当前书籍 ID。"),
      // 必须逐字段声明：宿主校验器会给 type: "object" 补 additionalProperties: false，
      // 声明成自由形态对象反而会让真实 preview 的所有字段都被拒。
      preview: {
        type: "object",
        description: "narrative.propose_change 返回的预览对象，原样回传。",
        properties: {
          id: stringSchema("预览 ID。"),
          summary: stringSchema("变更摘要。"),
          nodes: arraySchema("预览中的叙事节点。"),
          edges: arraySchema("预览中的叙事边。"),
          removeNodeIds: arraySchema("预览中待删除的节点 ID。", { type: "string" }),
          removeEdgeIds: arraySchema("预览中待删除的边 ID。", { type: "string" }),
          warnings: arraySchema("预览告警。"),
        },
        required: ["summary"],
      },
      decision: enumSchema(["approved", "rejected"], "审批结论：approved | rejected。"),
      reason: stringSchema("审批理由；驳回时建议填写，会写入审批台账。"),
    },
    required: ["bookId", "preview", "decision"],
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
  "chapter.write": {
    type: "object",
    properties: {
      chapterNumber: numberSchema("要写入的已存在章节序号。"),
      content: stringSchema("完整章节正文；会覆盖该章节当前内容。"),
    },
    required: ["chapterNumber", "content"],
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
      sceneSpec: sceneSpecSchema,
      canonEntries: arraySchema("Canon 层条目列表（可选，用于 H2 canon violation 检查）。", {
        type: "object",
        properties: {
          title: stringSchema("Canon 条目标题。"),
          contentMd: stringSchema("Canon 条目内容。"),
          category: stringSchema("Canon 类别。"),
        },
        required: ["title", "contentMd"],
        additionalProperties: false,
      }),
      povCharacter: stringSchema("当前 POV 角色名（可选，用于 H7 POV violation 检查）。"),
      wordTarget: numberSchema("目标字数（可选，用于 S1 字数范围检查）。"),
      checks: arraySchema("要执行的检查项（可选，默认全部）。可选值: continuity, rhythm, ai_taste, hooks, character, canon, pov", { type: "string" }),
    },
    required: ["bookId", "chapterNumber"],
    additionalProperties: false,
  },
  "rewrite.apply": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("章节序号。"),
      lineRange: lineRangeSchema,
      newText: stringSchema("替换内容。"),
      mode: stringSchema("写入模式：replace（替换选中行，默认）、insert_after（在选中行后插入）。"),
    },
    required: ["bookId", "chapterNumber", "lineRange", "newText"],
    additionalProperties: false,
  },
  "pipeline.import_chapters": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      content: stringSchema("要导入的 .txt/.md 文本内容；不得传服务器文件路径。"),
      sourceName: stringSchema("导入来源名称（可选）。"),
      splitPattern: stringSchema("章节分割正则（可选，默认匹配「第X章」「Chapter X」等）。"),
      maxChapters: numberSchema("最大导入章数（可选，默认 500）。"),
      autoSettle: booleanSchema("导入后是否自动 memory.settle_range（默认 true）。"),
      extractBrief: booleanSchema("导入后是否抽取角色/地点/钩子/焦点草案（默认 true）。"),
      applyDissectDraft: booleanSchema("是否把抽取草案写入 story 草稿文件（默认 false；true 时写 pending_hooks/focus/dissect_draft）。"),
    },
    required: ["bookId", "content"],
    additionalProperties: false,
  },
  "outline.volume": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["get", "set", "suggest"], "操作：get（默认，读卷纲）| set（落盘 volumes）| suggest（生成草案，不落盘）。"),
      volumes: arraySchema("action=set 时的卷列表。每项 {id?,title,chapterRange:{from,to},goal?,status?}。", {
        type: "object",
        properties: {
          id: stringSchema("卷 ID（可选）。"),
          title: stringSchema("卷标题。"),
          chapterRange: {
            type: "object",
            description: "章节范围。",
            properties: { from: numberSchema("起始章。"), to: numberSchema("结束章。") },
            required: ["from", "to"],
            additionalProperties: false,
          },
          goal: stringSchema("本卷要达成的剧情结果。"),
          status: enumSchema(["planned", "active", "done"], "卷状态。"),
          notes: stringSchema("备注（可选）。"),
        },
        required: ["title"],
        additionalProperties: false,
      }),
      volumeCount: numberSchema("action=suggest 时期望卷数（默认 3）。"),
      targetChapters: numberSchema("action=suggest 时全书目标章数（默认读 book.json）。"),
      endgameReserve: {
        type: "object",
        description: "终局储备（防中盘塌陷）：底牌逐卷解锁、升级台阶不越级。action=set 时可传；不传保留已有。",
        properties: {
          trumpCards: arraySchema("一次性底牌，打出去就没了。", {
            type: "object",
            properties: {
              id: stringSchema("底牌 ID（可选）。"),
              kind: enumSchema(
                ["arch-enemy", "ultimate-truth", "power-ceiling", "identity-end", "emotion-end"],
                "类别：头号宿敌 / 终极真相 / 金手指上限 / 身份终点 / 核心情感终点。",
              ),
              name: stringSchema("底牌名称。"),
              unlockAtVolume: numberSchema("最早允许动用的卷序号（1 起）。"),
              spentAtVolume: numberSchema("已在第几卷动用；未动用则省略。"),
              notes: stringSchema("备注（可选）。"),
            },
            required: ["name", "unlockAtVolume"],
            additionalProperties: false,
          }),
          ladders: arraySchema("递进式升级线，不许越级。", {
            type: "object",
            properties: {
              id: stringSchema("台阶 ID（可选）。"),
              name: stringSchema("升级线名称，如境界/地图/势力层级。"),
              totalSteps: numberSchema("总档数。"),
              currentStep: numberSchema("当前档位（0 表示未起步）。"),
              maxStepThisVolume: numberSchema("本卷允许到达的最高档（可选）。"),
            },
            required: ["name", "totalSteps", "currentStep"],
            additionalProperties: false,
          }),
        },
        additionalProperties: false,
      },
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "arc.character": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["status", "sync", "refine"], "操作：status（默认只读）| sync（按规则从正文同步 beats）| refine（LLM 精修）。"),
      chapterNumber: numberSchema("sync/refine 的目标章号（默认最新章）。"),
      characterName: stringSchema("只看某个角色（可选，status 用）。"),
      mode: enumSchema(["rule", "llm"], "sync 的抽取模式（默认 rule；refine 固定 llm）。"),
      stagnantThreshold: numberSchema("弧线停滞告警阈值章数（默认 5）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "publish.check": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      platform: enumSchema(["qidian", "jjwxc", "fanqie", "qimao", "generic"], "选择对应平台的写作建议（缺省按 book.platform 映射；不代表官方审核规则）。"),
      chapterNumber: numberSchema("只检查单章（可选）。"),
      fromChapter: numberSchema("起始章（可选）。"),
      toChapter: numberSchema("结束章（可选）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "book.dissect": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      fromChapter: numberSchema("起始章（可选，默认 1）。"),
      toChapter: numberSchema("结束章（可选，默认最新章）。"),
      targets: arraySchema("抽取目标：characters|world|hooks|summaries|style|all（默认 all）。", { type: "string" }),
      apply: booleanSchema("是否写入 story 草稿（默认 false，只返回草案）。"),
      settle: booleanSchema("是否先/同时对范围内章节 settle（默认 false）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "character.check_consistency": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      characterName: stringSchema("角色名（可选，不传则检查所有角色）。"),
      chapterRange: chapterRangeSchema,
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
  "writing-skills.read": {
    type: "object",
    properties: {
      scope: enumSchema(["enabled", "available"], "enabled=当前项目 `.novelfork/skills/` 中生效的 Writing Skills（含正文）；available=全部可用 Writing Skills（含项目目录标记）。默认 available。"),
    },
    required: [],
    additionalProperties: false,
  },
  "writing-skills.write": {
    type: "object",
    properties: {
      addSkillIds: arraySchema("将指定 catalog Writing Skill 物化到当前项目 `.novelfork/skills/`；不影响其它已存在的项目 Skill。", { type: "string" }),
      removeSkillIds: arraySchema("删除当前项目 `.novelfork/skills/` 中指定 catalog Writing Skill 的文件夹。", { type: "string" }),
      refreshSkillIds: arraySchema("用 catalog 原文刷新当前项目中指定 Writing Skill；作者已修改的项目文件不会自动刷新。", { type: "string" }),
    },
    required: [],
    additionalProperties: false,
  },
  "writing-skills.recommend": {
    type: "object",
    properties: {
      maxCount: numberSchema("最多返回几条推荐；缺省 6（启用的 Skill 正文每章注入 style 通道，过多会挤占记忆预算）。"),
    },
    required: [],
    additionalProperties: false,
  },
  "writing-skills.check_compliance": {
    type: "object",
    properties: {
      content: stringSchema("要检查的章节内容文本。"),
      chapterNumber: numberSchema("章节序号（可选，用于上下文）。"),
    },
    required: ["content"],
    additionalProperties: false,
  },
  "writing-skills.import_legacy": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  "pipeline.write": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      sceneSpec: sceneSpecSchema,
      content: stringSchema("当前 Runtime Agent 已完成的章节正文；pipeline.write 只做校验与保存，不在工具内部生成。"),
      jingweiContext: stringSchema("按 scene spec 补读的经纬上下文文本（可选）。"),
      previousChapterTail: stringSchema("前一章末尾 500 字（可选，用于衔接）。"),
      autoRevise: booleanSchema("是否自动修订审计不过的 critical 问题。默认 true。"),
      continueWithHighRiskPending: booleanSchema("存在 high-risk pending NarrativeEvents 时是否明确继续写作。默认 false，会先返回处理提醒。"),
      adversarialAudit: booleanSchema("是否启用多视角对抗式审计。"),
      maxReviseRounds: numberSchema("最大自动修订轮数。"),
      acknowledgedSkills: acknowledgedSkillsSchema,
      requireFactCheckPass: booleanSchema("若仍有 critical 事实/连续性 S1 未清，则拒绝保存正式章（默认 false，只标 needsHumanReview）。"),
      factCheckAutoRevise: booleanSchema("普通审修后若仍有 critical 事实/连续性问题，额外触发 1 轮事实专项 spot-fix + 复审（默认 false）。"),
    },
    required: ["bookId", "sceneSpec", "content"],
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
      action: stringSchema(
        "操作类型：create（创建）| update（更新）| delete（删除非 canon）| retire（退役，含错误/过期 canon：退出 AI，不改 layer/正文）。默认根据标题自动判断创建或更新。",
      ),
      title: stringSchema("条目标题（用于匹配已有条目，标题相同则更新）。"),
      contentMd: stringSchema("条目内容（Markdown 格式）。delete/retire 时不需要。"),
      summaryMd: stringSchema("条目短摘要（可选；未提供时自动截断生成）。"),
      category: stringSchema("经纬类别。"),
      layer: stringSchema("数据层：canon（不可变真相）| dynamic（每章可更新）| reference（按需查阅）。默认 dynamic。"),
      aliases: arraySchema("别名列表。", { type: "string" }),
      tags: arraySchema("标签列表。", { type: "string" }),
      visibility: stringSchema("可见性规则：global | tracked | nested。默认 tracked。"),
      relatedEntryIds: arraySchema("关联条目 ID 列表。", { type: "string" }),
      entryId: stringSchema("条目 ID（delete/retire 时可用，按 ID 精确操作）。"),
      mode: stringSchema("写入模式：overwrite（覆盖，默认）、append（追加到已有内容末尾）。"),
      confirmCanonEdit: booleanSchema("修改或退役 Canon 条目时必须设为 true"),
      reason: stringSchema("变更原因；写入 canon/rules 或 retire 时必填。"),
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
      userDirectives: stringSchema("用户对本章的一句写作指示/方向（禁止塞写作理论长文）。"),
      sceneSpec: sceneSpecSchema,
      acceptFocusDefault: booleanSchema("当 write.preflight 仅给出 focus 默认目标时，是否接受继续。"),
      cockpitSnapshot: { type: "object", description: "驾驶舱快照（可选，用于提取进度、伏笔、风险等上下文）。" },
      jingweiBrief: { type: "object", description: "兼容旧字段：经纬/Lore 核心包摘要（可选）。新调用优先使用 loreBrief。" },
      loreBrief: { type: "object", description: "lore.read 返回的静态设定核心包（可选，用于提取角色、地点、世界观等设定）。" },
      memoryContext: { type: "object", description: "memory.read 返回的动态叙事记忆上下文（可选，用于时间线、伏笔、事实和角色状态约束）。" },
      beatBudget: arraySchema(
        "情节点字数预算（可选；不传则由 LLM 规划）。密点展开、疏点带过，总和落在 [wordTarget, wordTarget×1.1]。",
        {
          type: "object",
          properties: {
            summary: stringSchema("这一拍具体发生什么（写清事件，不要只写动词）。"),
            density: enumSchema(["dense", "normal", "sparse"], "密度：dense 爽点/反转（≥250字）| normal 常规 | sparse 过场（≤150字）。"),
            words: numberSchema("分配字数。"),
            function: stringSchema("功能标签，如 信息揭示/冲突升级/情绪转折（可选）。"),
          },
          required: ["summary", "density", "words"],
          additionalProperties: false,
        },
      ),
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
      query: stringSchema("scope=search 时必填，搜索关键词；支持空格分隔多个词（多词取 AND 语义），按标题/别名/标签/摘要/正文加权匹配。"),
      categories: arraySchema("scope=search 时可选，限定搜索的分类列表（如 characters / factions）。", { type: "string" }),
      includeUnconfirmed: booleanSchema("scope=search 时可选：是否纳入 draft / needs-review 条目。默认 false（只读已确认条目）；作者侧检索传 true。"),
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
  "memory.list": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: memoryKindSchema,
      status: eventStatusSchema,
      layer: factLayerSchema,
      category: stringSchema("事实 category 或事件 eventType 过滤。"),
      chapterRange: arraySchema("章节范围 [from, to]（可选）。", { type: "number" }),
      query: stringSchema("关键词过滤（可选）。"),
      limit: numberSchema("返回数量上限（默认 50，最大 500）。"),
      offset: numberSchema("分页偏移量（默认 0）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "memory.read_entry": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: memoryKindSchema,
      id: stringSchema("条目 ID。fact/event/log 使用 id，vector 使用 cardId。"),
    },
    required: ["bookId", "kind", "id"],
    additionalProperties: false,
  },
  "memory.search": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      query: stringSchema("搜索关键词。"),
      kind: memoryKindSchema,
      status: eventStatusSchema,
      limit: numberSchema("返回数量上限（默认 50，最大 500）。"),
    },
    required: ["bookId", "query"],
    additionalProperties: false,
  },
  "memory.update": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: writableMemoryKindSchema,
      id: stringSchema("条目 ID。"),
      patch: { type: "object", description: "要更新的字段补丁。fact/event 只允许白名单字段。" },
      reason: stringSchema("修改原因，必填，用于审计。"),
    },
    required: ["bookId", "kind", "id", "patch", "reason"],
    additionalProperties: false,
  },
  "memory.delete": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: writableMemoryKindSchema,
      id: stringSchema("条目 ID。"),
      reason: stringSchema("删除原因，必填，用于审计。"),
    },
    required: ["bookId", "kind", "id", "reason"],
    additionalProperties: false,
  },
  "memory.dedup": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: writableMemoryKindSchema,
      limit: numberSchema("返回重复候选组上限。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "memory.export": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: memoryKindSchema,
      format: jsonFormatSchema,
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "memory.stats": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "memory.bulk_approve": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      eventIds: arraySchema("要批准的事件 ID 列表。", { type: "string" }),
      filter: memoryFilterSchema,
      reason: stringSchema("批量批准原因，必填，用于审计。"),
      limit: numberSchema("最多处理数量（默认 100，最大 200）。"),
    },
    required: ["bookId", "reason"],
    additionalProperties: false,
  },
  "memory.bulk_delete": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      kind: writableMemoryKindSchema,
      filter: memoryFilterSchema,
      limit: numberSchema("最多删除数量（默认 50，最大 200）。"),
      reason: stringSchema("批量删除原因，必填，用于审计。"),
    },
    required: ["bookId", "kind", "filter", "reason"],
    additionalProperties: false,
  },
  "resource.manage": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: stringSchema("list（列出正式章节结果）/archive（归档）/delete（删除）。"),
      resourceId: stringSchema("action 非 list 时必填：目标资源 ID。"),
      filter: {
        type: "object",
        description: "action=list 时可选过滤。",
        properties: {
          type: { type: "string", enum: ["chapter"] },
          status: { type: "string", enum: ["accepted", "archived"] },
        },
        additionalProperties: false,
      },
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
};

NOVEL_TOOL_SCHEMAS["lore.read"] = NOVEL_TOOL_SCHEMAS["jingwei.read"]!;
NOVEL_TOOL_SCHEMAS["lore.write"] = NOVEL_TOOL_SCHEMAS["jingwei.write"]!;
