/**
 * Novel tool inputSchema definitions — the single source of truth for the 25 novel tools.
 *
 * 按全量常驻级轻量原则设计：
 * - 去除重复声明的嵌套结构与历史废弃兼容字段
 * - 所有工具按领域聚合，宿主注入的 bookId 会在 toRuntimeInputSchema 中剥离，不暴露给模型
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

function relativeBookFileSchema(description: string): Record<string, unknown> {
  return {
    type: "string",
    pattern: "^(?![/\\\\])(?![A-Za-z]:)(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$)).+$",
    description,
  };
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
const eventStatusSchema = enumSchema(["pending", "applied", "rejected"], "事件状态：pending | applied | rejected。");
const factLayerSchema = enumSchema(["canon", "dynamic", "reference"], "事实层：canon | dynamic | reference。");

const chapterRangeSchema = {
  type: "object",
  properties: {
    from: numberSchema("起始章节号（含）。"),
    to: numberSchema("结束章节号（含）。"),
  },
  additionalProperties: false,
};

/** 伏笔条目的可选结构化字段（可不填）。 */
const foreshadowFieldProperties = {
  triggerCondition: stringSchema("伏笔触发条件（一句话）。"),
  triggerKeywords: arraySchema("伏笔触发词（人物/物件/地点）。", { type: "string" }),
  targetRange: stringSchema("预定回收章或区间，如 \"120\" 或 \"120-140\"。"),
  payoffConstraint: stringSchema("回收时必须成立的条件。"),
  importance: enumSchema(["low", "med", "high"], "伏笔分量：low | med | high。"),
};

const sceneSpecSchema = {
  type: "object",
  description: "结构化写作蓝图（高密度施工控制卡）。",
  properties: {
    chapter: numberSchema("目标章节号。"),
    title: stringSchema("章节标题。"),
    wordTarget: numberSchema("目标字数。"),
    engineRole: enumSchema(["payoff", "buildup", "upgrade", "pivot"], "本章爽感引擎角色：payoff | buildup | upgrade | pivot。"),
    contractCheck: {
      type: "object",
      description: "因果权与结算权归属自检（可选）。",
      properties: {
        agencyOwner: stringSchema("推动核心破局的主导者。"),
        payoffOwner: stringSchema("核心收益/爽感归属者。"),
      },
      additionalProperties: false,
    },
    beatBudget: arraySchema("情节点字数预算：密点展开、疏点带过，总和覆盖整章。", {
      type: "object",
      properties: {
        summary: stringSchema("这一拍具体发生什么。"),
        density: enumSchema(["dense", "normal", "sparse"], "密度：dense | normal | sparse。"),
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
        sceneMode: enumSchema(["active", "reactive"], "场景模式：active 主动场 | reactive 被动场。"),
        valueTurn: {
          type: "object",
          description: "起止价值电荷翻转（避免非事件场）。",
          properties: {
            from: stringSchema("开场价值状态。"),
            to: stringSchema("收尾价值状态。"),
          },
          required: ["from", "to"],
          additionalProperties: false,
        },
        expectationGap: {
          type: "object",
          description: "主观期望与客观结果的戏剧鸿沟。",
          properties: {
            expectation: stringSchema("视点角色预期结果。"),
            reality: stringSchema("实际遭遇的相反或升级阻力。"),
          },
          required: ["expectation", "reality"],
          additionalProperties: false,
        },
        entryPoint: stringSchema("最后时刻深切入点（跳过寒暄过场，从哪一冲突瞬间起戏）。"),
        infoMode: enumSchema(["suspense", "mystery", "irony"], "信息差模式：suspense | mystery | irony。"),
        microBeats: arraySchema("场内因果小节拍（A→B→C）。", { type: "string" }),
        infoPayloads: arraySchema("本场必须交付的具体信息增量/物证/规则细节。", { type: "string" }),
        reactionPairs: arraySchema("关键动作与在场配角差异化反应对。", {
          type: "object",
          properties: {
            action: stringSchema("关键动作或信息抛出。"),
            reactions: stringSchema("配角差异化即时反应。"),
          },
          required: ["action", "reactions"],
          additionalProperties: false,
        }),
        forbid: arraySchema("本场禁区（严禁提前泄露的底牌或失真行为）。", { type: "string" }),
        gaps: arraySchema("规划留白（动机/细节/节奏的真实答案）。", {
          type: "object",
          properties: {
            kind: enumSchema(["motivation", "detail", "pacing"], "类别：motivation | detail | pacing。"),
            gap: stringSchema("缺口问题。"),
            answer: stringSchema("真实答案。"),
          },
          required: ["kind", "gap", "answer"],
          additionalProperties: false,
        }),
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
 * 25 个精锐小说领域工具的 inputSchema 定义
 */
export const NOVEL_TOOL_SCHEMAS: Record<string, ToolInputSchema> = {
  // ─── 1. 核心写章与章节（8） ───────────────────────────────────────────────
  "book.overview": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
    },
    required: [],
    additionalProperties: false,
  },
  "chapter.preflight": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号（可选，默认下一章）。"),
      userDirectives: stringSchema("本章一句写作指示（可选）。"),
      acceptFocusDefault: booleanSchema("仅有焦点默认目标时是否接受继续（默认 false）。"),
      sceneSpec: sceneSpecSchema,
      pinnedSampleIds: arraySchema("可选：作者点选优先注入的文风范文 ID。", { type: "string" }),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "chapter.blueprint": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号。"),
      userDirectives: stringSchema("本章一句写作目标（≥8 字）。"),
      sceneSpec: sceneSpecSchema,
      acceptFocusDefault: booleanSchema("仅焦点默认目标时是否接受继续。"),
      namedEntities: arraySchema("本章点名重点实体（召回超上限时优先保留）。", { type: "string" }),
      pinnedMechanismIds: arraySchema("作者点选的机制卡 ID。", { type: "string" }),
      infoAnchors: arraySchema("作者指定的信息增量锚点。", { type: "string" }),
    },
    required: ["bookId", "chapterNumber", "userDirectives", "sceneSpec"],
    additionalProperties: false,
  },
  "chapter.commit": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      chapterNumber: numberSchema("目标章节序号（可选，缺省时从 filePath 或蓝图推断）。"),
      filePath: relativeBookFileSchema("可选：刚用原生 Write/Edit 写入的章节相对路径（如 chapters/卷01/0001_标题.md）。"),
      title: stringSchema("可选：章节标题（缺省时取蓝图标题或正文首行标题）。"),
      mode: enumSchema(["new", "revision"], "提交模式：new 新章入库（默认，执行完整预检/蓝图/审计/结算）| revision 已有章节改稿提交（校验长度/技能/高风险门禁并更新索引与重结算）。"),
      sceneSpec: sceneSpecSchema,
      content: stringSchema("可选：仅无磁盘文件或测试时直传正文；日常写章请先用原生 Write/Edit 写盘再调本工具。"),
      jingweiContext: stringSchema("可选：补充经纬上下文文本。"),
      previousChapterTail: stringSchema("可选：前一章末尾衔接文本。"),
      requireFactCheckPass: booleanSchema("审计仍有严重事实/连续性问题时是否拒存（默认 false）。"),
      fromWorkflowRun: booleanSchema("工作流落盘工序用：true 时正文与蓝图取自当前运行的已确认候选。"),
    },
    required: ["bookId"],
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
      mode: enumSchema(["quality", "publish"], "检查模式：quality 单章质量审计（默认）| publish 投稿前敏感词/AI 味/完整性风险自检。"),
      chapterNumber: numberSchema("章节序号（mode=quality 必填；mode=publish 可选）。"),
      fromChapter: numberSchema("mode=publish 起始章（可选）。"),
      toChapter: numberSchema("mode=publish 结束章（可选）。"),
      platform: enumSchema(["qidian", "jjwxc", "fanqie", "qimao", "generic"], "mode=publish 目标平台（可选，缺省按书籍配置映射）。"),
      content: stringSchema("章节正文（可选，不传则读取已保存章节）。"),
      sceneSpec: sceneSpecSchema,
      povCharacter: stringSchema("当前视角角色名（可选）。"),
      wordTarget: numberSchema("目标字数（可选）。"),
      checks: arraySchema("检查项：continuity, rhythm, ai_taste, hooks, character, canon, pov。", { type: "string" }),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "chapter.propose_selection": {
    type: "object",
    properties: {
      requestId: stringSchema("写作台选区请求编号，原样传回。"),
      chapterNumber: numberSchema("选中章节序号。"),
      from: numberSchema("选区起点（可选，与 to 成对）。"),
      to: numberSchema("选区终点（可选，与 from 成对）。"),
      sourceText: stringSchema("选中的原文片段。"),
      candidateText: stringSchema("候选改写文本（不直接改文件）。"),
      action: enumSchema(["continue", "polish", "rewrite", "expand", "compress"], "操作类型。"),
    },
    required: ["requestId", "chapterNumber", "sourceText", "candidateText", "action"],
    additionalProperties: false,
  },
  "chapter.discard_range": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      fromChapter: numberSchema("起始章节（含）。"),
      toChapter: numberSchema("结束章节（含）。"),
      confirm: booleanSchema("必须为 true。"),
      deleteMemory: booleanSchema("是否清除范围内记忆（默认 true）。"),
      resetHooks: enumSchema(["untouched", "planned-only", "none"], "伏笔重置策略（默认 untouched）。"),
      hardDelete: booleanSchema("true 时尽量物理删除章节文件（默认 false 归档）。"),
    },
    required: ["bookId", "fromChapter", "toChapter", "confirm"],
    additionalProperties: false,
  },

  // ─── 2. 经纬与大纲（4） ───────────────────────────────────────────────────
  "jingwei.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      scope: enumSchema(["brief", "category", "search", "audit"], "范围：brief 核心包（默认）| category 分类读取 | search 关键词搜索 | audit 经纬可用性审计。"),
      category: stringSchema("scope=category 时必填分类名。"),
      query: stringSchema("scope=search 时必填关键词（空格分隔 AND 匹配）。"),
      categories: arraySchema("scope=search 时可选限定分类列表。", { type: "string" }),
      includeUnconfirmed: booleanSchema("scope=search 时是否纳入 draft/needs-review（默认 false）。"),
      entryIds: arraySchema("scope=audit 时可选限定条目 ID。", { type: "string" }),
      chapterNumber: numberSchema("当前章节号（可选）。"),
      sceneText: stringSchema("当前场景文本（可选，相关性排序）。"),
      chapterIntent: stringSchema("本章写作意图（可选）。"),
      tokenBudget: numberSchema("token 预算（可选）。"),
      detailLevel: enumSchema(["summary", "normal", "full"], "详情等级（默认 summary）。"),
      page: numberSchema("分页页码（scope=category）。"),
      limit: numberSchema("每页条数（scope=category/search）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "jingwei.write": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(
        ["create", "update", "delete", "retire", "relate", "progress", "propose", "propose_storyline"],
        "操作：create/update/delete/retire 静态设定 | relate 关系变化 | progress 动态字段演变 | propose 字段修改候选 | propose_storyline 剧情线草稿。",
      ),
      title: stringSchema("条目标题（create/update/progress）。"),
      contentMd: stringSchema("条目正文 Markdown（create/update）。"),
      summaryMd: stringSchema("短摘要（可选）。"),
      category: stringSchema("经纬分类（如 characters / world-model / factions / power-system / rules / foreshadowing）。"),
      layer: enumSchema(["canon", "dynamic", "reference"], "数据层（默认 dynamic）。"),
      aliases: arraySchema("别名列表。", { type: "string" }),
      tags: arraySchema("标签列表。", { type: "string" }),
      visibility: enumSchema(["global", "tracked", "nested"], "可见性（默认 tracked）。"),
      relatedEntryIds: arraySchema("关联条目 ID。", { type: "string" }),
      fields: {
        type: "object",
        description: "结构化字段（整体写入）。",
        additionalProperties: true,
      },
      entryId: stringSchema("条目 ID（delete/retire/progress/propose）。"),
      entryKey: stringSchema("条目唯一键（可选）。"),
      mode: enumSchema(["overwrite", "append"], "写入模式（默认 overwrite）。"),
      confirmCanonEdit: booleanSchema("修改或退役 Canon 时必须为 true。"),
      reason: stringSchema("变更原因（canon/rules/retire/relate/progress/propose 必填）。"),
      source: stringSchema("设定来源（写入 canon/rules 时与 evidence 至少一项）。"),
      evidence: stringSchema("证据摘录。"),
      status: enumSchema(["draft", "confirmed", "needs-review"], "条目状态。"),
      stagingId: stringSchema("拆书暂存候选 ID。"),
      stagingDecision: enumSchema(["promote", "reject"], "拆书候选处理：promote | reject。"),
      sourceRefs: arraySchema("证据来源数组。", {
        type: "object",
        properties: { chapterNumber: numberSchema("章节号。"), excerpt: stringSchema("摘录。") },
        required: ["chapterNumber", "excerpt"],
        additionalProperties: false,
      }),
      entries: arraySchema("批量写入多条设定（最多 20 条）。", { type: "object", additionalProperties: true }),
      // relate 专用
      sourceName: stringSchema("relate：关系主体名。"),
      targetName: stringSchema("relate：关系客体名。"),
      relationType: stringSchema("relate：关系类型（结盟/敌对/师徒等）。"),
      description: stringSchema("relate/progress：现状或演变一句话描述。"),
      chapterNumber: numberSchema("relate/progress：发生变化的章节号。"),
      // progress 专用
      fieldKey: stringSchema("progress：推进的字段键（如 status / phase / targetRange）。"),
      oldValue: stringSchema("progress：旧值（可选）。"),
      newValue: stringSchema("progress：新值。"),
      // propose 专用
      fieldsPatch: { type: "object", description: "propose：要改的字段补丁。" },
      // propose_storyline 专用
      name: stringSchema("propose_storyline：剧情线名称。"),
      kind: enumSchema(["main", "sub", "romance", "faction", "mystery", "character-arc", "other"], "propose_storyline：类别。"),
      goal: stringSchema("propose_storyline：一句话目标。"),
      relatedEntryTitles: arraySchema("propose_storyline：强关联经纬条目标题。", { type: "string" }),
      evidenceNote: stringSchema("propose_storyline：归纳依据。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "hooks.manage": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["plant", "payoff", "check_due", "list", "delete"], "操作：plant | payoff | check_due | list | delete。"),
      hookId: stringSchema("伏笔 ID（payoff/delete）。"),
      chapterNumber: numberSchema("章节号（plant/payoff/check_due）。"),
      description: stringSchema("伏笔描述（plant）。"),
      ...foreshadowFieldProperties,
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
  "outline.volume": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["get", "set", "suggest"], "操作：get 读卷纲（默认）| set 落盘 | suggest 生成规则草案。"),
      volumes: arraySchema("action=set 时的卷列表。", {
        type: "object",
        properties: {
          id: stringSchema("卷 ID（可选）。"),
          title: stringSchema("卷标题。"),
          chapterRange: {
            type: "object",
            properties: { from: numberSchema("起始章。"), to: numberSchema("结束章。") },
            required: ["from", "to"],
            additionalProperties: false,
          },
          goal: stringSchema("本卷剧情目标。"),
          controllingIdea: stringSchema("本卷主控思想（价值+原因）。"),
          designPrinciple: stringSchema("本卷设计原则（主角弱点 W × 行动 A = 转变 C）。"),
          antagonistWeb: stringSchema("本卷冰山对手/四角对立网络。"),
          stageCheckpoints: {
            type: "object",
            properties: {
              setupTurn: stringSchema("约 25% 第一情节点。"),
              midpointReversal: stringSchema("约 50% 中点翻转。"),
              darkNight: stringSchema("约 75% 暗夜时刻。"),
              climaxShowdown: stringSchema("终局压力锅对决。"),
            },
            additionalProperties: false,
          },
          status: enumSchema(["planned", "active", "done"], "卷状态。"),
          notes: stringSchema("备注。"),
        },
        required: ["title"],
        additionalProperties: false,
      }),
      volumeCount: numberSchema("action=suggest 期望卷数（默认 3）。"),
      targetChapters: numberSchema("action=suggest 目标章数。"),
      endgameReserve: {
        type: "object",
        description: "终局储备（底牌与升级台阶，action=set 可选）。",
        additionalProperties: true,
      },
    },
    required: ["bookId"],
    additionalProperties: false,
  },

  // ─── 3. 叙事记忆（5） ─────────────────────────────────────────────────────
  "memory.read": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      purpose: enumSchema(["write", "revise", "audit", "outline", "diagnose"], "召回目的。"),
      chapterNumber: numberSchema("目标章节序号（可选）。"),
      entities: arraySchema("关注实体列表（可选）。", { type: "string" }),
      sceneText: stringSchema("当前场景文本或写作意图（可选）。"),
      budgetTokens: numberSchema("总 token 预算（可选）。"),
      channels: arraySchema("限定召回通道（可选）：hard | state | relationship | timeline | hooks | facts | style | semantic | character-kernel | recent-summary | knowledge | prose-evidence。", { type: "string" }),
    },
    required: ["bookId", "purpose"],
    additionalProperties: false,
  },
  "memory.search": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      mode: enumSchema(["facts", "text", "list"], "模式：facts 搜事实与事件（默认）| text 搜章节正文旧细节 | list 盘点记忆清单。"),
      query: stringSchema("关键词（facts/text 必填；list 可选）。"),
      match: enumSchema(["all", "any"], "text 模式匹配：all 全部命中同段（默认）| any 任一命中。"),
      kind: memoryKindSchema,
      status: eventStatusSchema,
      layer: factLayerSchema,
      category: stringSchema("list：事实 category 或事件类型过滤。"),
      fromChapter: numberSchema("起始章（可选）。"),
      toChapter: numberSchema("结束章（可选）。"),
      chapterRange: arraySchema("list：章节范围 [from, to]。", { type: "number" }),
      limit: numberSchema("返回条数上限。"),
      offset: numberSchema("list：分页偏移量。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },
  "memory.graph": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      view: enumSchema(["relationship", "timeline", "character_arc", "foreshadowing", "conflict", "event_chain", "wave"], "图谱视图。"),
      focusEntity: stringSchema("聚焦实体名（可选）。"),
      focusEntryId: stringSchema("经纬条目 ID（优先按身份链过滤）。"),
      chapterRange: arraySchema("章节范围 [from, to]。", { type: "number" }),
    },
    required: ["bookId", "view"],
    additionalProperties: false,
  },
  "memory.events": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["list", "create", "approve", "reject", "bulk_approve"], "操作：list | create | approve | reject | bulk_approve。"),
      eventId: stringSchema("approve/reject：事件 ID。"),
      eventIds: arraySchema("bulk_approve：事件 ID 列表。", { type: "string" }),
      filter: { type: "object", description: "bulk_approve：可选筛选条件（status/layer/category/chapterRange/query）。", additionalProperties: true },
      chapterNumber: numberSchema("create：章节序号。"),
      eventType: stringSchema("create：事件类型。"),
      subject: stringSchema("create：事件主体。"),
      predicate: stringSchema("create：谓词/关系。"),
      object: stringSchema("create：客体/状态。"),
      evidenceText: stringSchema("create：证据文本。"),
      confidence: numberSchema("create：置信度 0-1。"),
      layer: factLayerSchema,
      source: enumSchema(["agent", "manual"], "create：来源（agent 低风险自动生效 | manual 一律待确认）。"),
      reason: stringSchema("approve/reject/bulk_approve：操作原因。"),
      limit: numberSchema("list/bulk_approve：处理条数上限。"),
      events: arraySchema("create：批量创建事件（最多 20 条）。", { type: "object", additionalProperties: true }),
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
  "memory.settle": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["chapter", "range"], "可选：chapter 单章结算 | range 范围补结算（省略时按 chapterNumber 或 fromChapter/toChapter 自动判断）。"),
      chapterNumber: numberSchema("单章结算的章节号（正文须已落盘）。"),
      title: stringSchema("单章结算记录展示标题（可选）。"),
      force: booleanSchema("单章正文未变时是否强制重结（默认 false）。"),
      fromChapter: numberSchema("范围补结算起始章（含）。"),
      toChapter: numberSchema("范围补结算结束章（含）。"),
      source: enumSchema(["accepted-resources", "chapter-files"], "范围补结算正文来源（默认 accepted-resources）。"),
      dryRun: booleanSchema("范围补结算仅扫描不落库（默认 false）。"),
    },
    required: ["bookId"],
    additionalProperties: false,
  },

  // ─── 4. 专项与工作流（8） ─────────────────────────────────────────────────
  "character.inspect": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(
        ["consistency", "arc_status", "arc_sync", "voice_read", "voice_draft"],
        "操作：consistency 出场与人设一致检查 | arc_status 角色弧线状态 | arc_sync 同步章节弧线 | voice_read 读声线 | voice_draft 生成声线待审草稿。",
      ),
      entryId: stringSchema("voice_read/voice_draft：角色经纬条目 ID。"),
      characterName: stringSchema("角色名（各 action 通用）。"),
      chapterNumber: numberSchema("arc_sync：章节号。"),
      chapterRange: chapterRangeSchema,
      mode: enumSchema(["append", "rebuild"], "arc_sync：模式（默认 append）。"),
      stagnantThreshold: numberSchema("arc_status：停滞告警阈值章数（默认 10）。"),
      expectedVersion: numberSchema("voice_draft：voice_read 返回的版本号。"),
      dialogueSamples: arraySchema("voice_draft：角色对白原句样本。", { type: "string" }),
      scanChapters: numberSchema("voice_draft：扫描近几章对白（默认 10）。"),
      useModel: booleanSchema("voice_draft：是否用当前会话模型增补。"),
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
  "style.manage": {
    type: "object",
    properties: {
      action: enumSchema(
        ["index", "preview", "start", "status", "adopt", "consolidate", "negative_override"],
        "操作：index 索引参考文件 | preview 预览切章 | start 启动/续跑蒸馏 | status 查任务结果 | adopt 采纳规则/范文 | consolidate 规则瘦身 | negative_override 置顶负反馈硬约束。",
      ),
      filePath: relativeBookFileSchema("参考文件相对路径（index/preview/start）。"),
      sourceName: stringSchema("参考来源名。"),
      text: stringSchema("直接传入的参考正文。"),
      chapters: arraySchema("已切分章节数组。", { type: "object", additionalProperties: true }),
      splitPattern: stringSchema("章节标题正则。"),
      listFilesOnly: booleanSchema("index：仅列出参考文件。"),
      offset: numberSchema("index：分页起点。"),
      limit: numberSchema("index：分页条数。"),
      chapterList: arraySchema("抽样章号列表。", { type: "number" }),
      fromChapter: numberSchema("起始章号。"),
      toChapter: numberSchema("结束章号。"),
      jobId: stringSchema("蒸馏任务 ID（start 续跑/status/adopt）。"),
      maxBatches: numberSchema("start：本次最多批次数（1–10）。"),
      retryFailed: booleanSchema("start：重试失败批次。"),
      ruleIds: arraySchema("adopt：作者确认采纳的规则 ID。", { type: "string" }),
      sampleIds: arraySchema("adopt：作者确认采纳的范文 ID。", { type: "string" }),
      expectedVersion: stringSchema("adopt：status 返回的版本号（无预设传空串）。"),
      role: enumSchema(["primary_voice", "register_overlay"], "adopt：主文风或局部语域插件。"),
      triggerTags: arraySchema("adopt：语域插件触发标签。", { type: "string" }),
      forbiddenSourceTerms: arraySchema("adopt：原著专名黑名单。", { type: "string" }),
      maxRules: numberSchema("consolidate：归约条数上限（1–12）。"),
      feedbackText: stringSchema("negative_override：作者口头纠偏原话。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
  "mechanism.distill": {
    type: "object",
    properties: {
      action: enumSchema(["extract", "list", "update", "delete", "recall"], "操作：extract | list | update | delete | recall。"),
      sourceTitle: stringSchema("extract：参考书名。"),
      filePath: relativeBookFileSchema("extract：参考文件相对路径。"),
      text: stringSchema("extract：参考正文。"),
      chapterRange: chapterRangeSchema,
      chapterList: arraySchema("extract：抽样章号（建议 ≤8 章）。", { type: "number" }),
      extraForbiddenTerms: arraySchema("extract：额外禁用的原著专名。", { type: "string" }),
      cardId: stringSchema("update/delete：机制卡 ID。"),
      name: stringSchema("update：机制名。"),
      readerDesire: stringSchema("update：读者爽点期待。"),
      emotionChain: stringSchema("update：情绪兑现链。"),
      triggerAndPayoff: stringSchema("update：触发与兑现闭环。"),
      abstractSlots: arraySchema("update：抽象槽位列表。", {
        type: "object",
        properties: { slot: stringSchema("槽位名。"), roleDescription: stringSchema("功能说明。") },
        required: ["slot", "roleDescription"],
        additionalProperties: false,
      }),
      forbiddenSourceTerms: arraySchema("update：原著专名黑名单。", { type: "string" }),
      tags: arraySchema("标签列表。", { type: "string" }),
      status: enumSchema(["needs-review", "confirmed"], "update：审核状态。"),
      query: stringSchema("recall：检索意图。"),
      maxCards: numberSchema("recall：返回上限（默认 4）。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
  "book.import": {
    type: "object",
    properties: {
      bookId: stringSchema("书籍 ID。"),
      action: enumSchema(["import_chapters", "dissect"], "操作：import_chapters 切章导入旧书 | dissect 按目的拆解已有正文抽取经纬草稿。"),
      // import_chapters
      content: stringSchema("import_chapters：待导入文本（与 filePath 二选一）。"),
      filePath: relativeBookFileSchema("import_chapters：书根内相对文件路径（与 content 二选一）。"),
      sourceName: stringSchema("import_chapters：来源名称。"),
      splitPattern: stringSchema("import_chapters：章节标题正则。"),
      maxChapters: numberSchema("import_chapters：最大导入章数（默认 500，最高 6000）。"),
      autoSettle: booleanSchema("import_chapters：导入后自动结算记忆（默认 true）。"),
      extractBrief: booleanSchema("import_chapters：导入后抽取草案（默认 true）。"),
      applyDissectDraft: booleanSchema("import_chapters：写入草案文件（默认 false）。"),
      // dissect
      fromChapter: numberSchema("dissect：起始章（默认 1）。"),
      toChapter: numberSchema("dissect：结束章（默认最新章）。"),
      targets: arraySchema("dissect：抽取目标 characters|world|hooks|summaries|style|all。", { type: "string" }),
      purpose: stringSchema("dissect：拆书目的（写后续/同人/改编/AI漫剧剧本）。"),
      apply: booleanSchema("dissect：是否写入经纬草稿（默认 false）。"),
      settle: booleanSchema("dissect：是否同步结算叙事记忆（默认 false）。"),
    },
    required: ["bookId", "action"],
    additionalProperties: false,
  },
  "market.radar": {
    type: "object",
    properties: {
      action: enumSchema(["ranks", "scan", "query", "sample"], "操作：ranks 查榜单清单 | scan 扫描公开榜单 | query 查询历史快照与分析 | sample 采样番茄公开样章指标。"),
      platform: enumSchema(["qidian", "fanqie", "all"], "平台：qidian | fanqie | all。"),
      rankTypes: arraySchema("scan：榜单键列表。", { type: "string" }),
      rankType: stringSchema("query：榜单键过滤。"),
      maxPages: numberSchema("scan：最多翻页数（1–5）。"),
      fromDate: stringSchema("query：起始日期 YYYY-MM-DD。"),
      toDate: stringSchema("query：结束日期 YYYY-MM-DD。"),
      analyze: booleanSchema("query：是否生成题材/标题/字数分析。"),
      categories: arraySchema("题材过滤列表。", { type: "string" }),
      limit: numberSchema("每榜条数上限（最高 200）。"),
      fanqieBookId: stringSchema("sample：番茄公开书籍 ID（非当前作品）。"),
      maxChapters: numberSchema("sample：采样章数（默认 3，最多 3）。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
  "skills.manage": {
    type: "object",
    properties: {
      action: enumSchema(["recommend", "check_compliance"], "操作：recommend 按建书设定推荐写作技能 | check_compliance 按已启用技能校验章节正文。"),
      maxCount: numberSchema("recommend：最多推荐条数（默认 6）。"),
      content: stringSchema("check_compliance：待检查的章节正文。"),
      chapterNumber: numberSchema("check_compliance：章节序号（可选）。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
  "workflow.step": {
    type: "object",
    properties: {
      action: enumSchema(["current", "submit", "blocker"], "操作：current 读当前工序简报 | submit 提交工序产物 | blocker 报告阻塞。"),
      runRevision: numberSchema("submit/blocker：最新运行版本号。"),
      stepId: stringSchema("工序 ID（多道并行时必填）。"),
      outcome: stringSchema("submit：分支工序结果键。"),
      kind: enumSchema(["scene-spec", "prose", "audit", "outline", "other"], "submit：产物类别。"),
      payload: { type: "object", description: "submit：产物内容（scene-spec/prose/audit/outline/other）。" },
      what: stringSchema("blocker：哪一步做不下去。"),
      why: stringSchema("blocker：为什么做不下去。"),
      suggestion: stringSchema("blocker：建议作者如何处理。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
  "workflow.manage": {
    type: "object",
    properties: {
      action: enumSchema(["list", "get", "edit", "start"], "操作：list 列方案 | get 读方案结构 | edit 编辑草稿 | start 启动已发布方案。"),
      recipeId: stringSchema("get/edit/start：方案 ID（start 省略时用本书默认工作流）。"),
      expectedRevision: numberSchema("edit：已有草稿当前版本号。"),
      copyFrom: stringSchema("edit：基于已有方案复制为草稿。"),
      name: stringSchema("edit：新建草稿名称。"),
      ops: arraySchema(
        "edit：图编辑指令数组（add_node / update_node / remove_node / connect / disconnect / set_meta）。",
        { type: "object", additionalProperties: true },
      ),
      chapterNumber: numberSchema("start：目标章节号。"),
    },
    required: ["action"],
    additionalProperties: false,
  },
};

/**
 * 面向模型的精简 schema：sceneSpec 完整子结构只在 chapter.blueprint 里展开一次，
 * 下游工具改为开放透传对象，进一步压低每轮常驻 token 开销。
 */
const SCENE_SPEC_PASSTHROUGH_SCHEMA = { type: "object", description: "可选：原样传入 chapter_blueprint 返回的 sceneSpec（服务端已按章缓存，可省略）。" };
const SCENE_SPEC_PASSTHROUGH_TOOLS: readonly string[] = ["chapter.preflight", "chapter.commit", "chapter.audit"];

function toModelFacingSchema(name: string, schema: ToolInputSchema): ToolInputSchema {
  if (!SCENE_SPEC_PASSTHROUGH_TOOLS.includes(name) || !schema.properties.sceneSpec) return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      sceneSpec: SCENE_SPEC_PASSTHROUGH_SCHEMA,
    },
  };
}

/** 模型看到的 schema；与 NOVEL_TOOL_SCHEMAS（服务端校验用的完整 schema）不同的工具才另给一份。 */
export function getModelFacingToolSchema(name: string): ToolInputSchema | undefined {
  const schema = NOVEL_TOOL_SCHEMAS[name];
  return schema ? toModelFacingSchema(name, schema) : undefined;
}
