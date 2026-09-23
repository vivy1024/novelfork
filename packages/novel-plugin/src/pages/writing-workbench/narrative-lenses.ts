/**
 * 叙事 4 大镜头规范与面板注册表
 *
 * 依据《前端叙事结构重构任务书》任务 5：
 * 50 个面板归到 4 个创作主镜头，一次只聚焦一组。
 *
 * 核心镜头：
 *  - write（写）：这一章怎么写
 *  - lore（理）：设定是什么
 *  - progression（推）：下一章写什么
 *  - audit（审）：这章行不行
 *
 * 基础支撑：
 *  - system（底座/资）：资源、版本、检查点与历史抽屉，不作为创作主镜头干扰心流
 */

export type NarrativeLensId = "write" | "lore" | "progression" | "audit" | "system";

export interface NarrativeLensDef {
  readonly id: NarrativeLensId;
  readonly label: string;
  readonly question: string;
  readonly description: string;
  readonly isPrimary: boolean;
}

export const NARRATIVE_LENSES: readonly NarrativeLensDef[] = [
  {
    id: "write",
    label: "写",
    question: "这一章怎么写",
    description: "聚焦正文创作、场景规约、写作技巧与行文分支",
    isPrimary: true,
  },
  {
    id: "lore",
    label: "理",
    question: "设定是什么",
    description: "理顺世界观、人物经纬、势力门派与共现关系",
    isPrimary: true,
  },
  {
    id: "progression",
    label: "推",
    question: "下一章写什么",
    description: "推演剧情线、节拍预算、伏笔债务与情绪弧线",
    isPrimary: true,
  },
  {
    id: "audit",
    label: "审",
    question: "这章行不行",
    description: "审查 AI 味、合规违规、风格漂移与连贯性",
    isPrimary: true,
  },
  {
    id: "system",
    label: "资",
    question: "底座与历史状态",
    description: "版本历史、回滚检查点、运行状态与资源树（收纳于抽屉）",
    isPrimary: false,
  },
] as const;

export interface PanelClassification {
  readonly panel: string;
  readonly lens: NarrativeLensId;
  readonly role: string;
  readonly explanation: {
    readonly what: string;
    readonly why: string;
    readonly action: string;
  };
}

/**
 * 50 个面板的镜头归属全景清单
 */
export const PANEL_CLASSIFICATIONS: readonly PanelClassification[] = [
  // ── 镜头 1：写（这一章怎么写） ──
  {
    panel: "WriteViewPanel",
    lens: "write",
    role: "主写作工作区集成面板",
    explanation: { what: "展示单章编辑器与上下文导轨", why: "提供纯粹沉浸的单章码字环境", action: "在当前章节输入正文并实时联动上下文" },
  },
  {
    panel: "ChapterEditor",
    lens: "write",
    role: "核心章节正文编辑器",
    explanation: { what: "承载章节 markdown/富文本的编辑引擎", why: "保障字符输入、字数统计与光标同步", action: "键入或修改本章正文字句" },
  },
  {
    panel: "ChapterContextRail",
    lens: "write",
    role: "写作右侧上下文导轨",
    explanation: { what: "本章前情、出场人物与场景规约提示", why: "避免作者码字时遗忘前置伏笔与人物动机", action: "快速查阅本章设定的上下文摘要" },
  },
  {
    panel: "SceneSpecPanel",
    lens: "write",
    role: "场景规约与节拍预算卡",
    explanation: { what: "展示本场冲突、情绪、目标字数与人物登场", why: "遵循细纲规约开写，防止偏航跑题", action: "确认或调整本章细化场景规格" },
  },
  {
    panel: "WritingSkillsPanel",
    lens: "write",
    role: "网文技巧与修辞辅助面板",
    explanation: { what: "精选网文修辞技巧、钩子与动作描写模式", why: "提供行文临场灵感与张力提升建议", action: "挑选合适技巧嵌入当前段落" },
  },
  {
    panel: "VariantsPanel",
    lens: "write",
    role: "段落变体与生成候选面板",
    explanation: { what: "展示同一情节的多样化行文方案", why: "对比不同情绪渲染与节奏走向", action: "采纳或微调满意的内容变体" },
  },
  {
    panel: "ChapterToolbar",
    lens: "write",
    role: "章节工具栏与状态快捷栏",
    explanation: { what: "提供保存、排版、统计与字数仪表盘", why: "保障行文操作随手可及", action: "执行快速格式化或状态切换" },
  },
  {
    panel: "ChapterActionsBar",
    lens: "write",
    role: "章节操作与交付底栏",
    explanation: { what: "完成章节发布、提交结算与 AI 校验操作", why: "串联章节创作后置处理", action: "点击交付进入章后结算与审核" },
  },
  {
    panel: "EditorMinimap",
    lens: "write",
    role: "长文结构缩略图",
    explanation: { what: "长文本分段结构缩略指示", why: "快速定位长篇章节内部小节", action: "点击跳转至目标小节位置" },
  },
  {
    panel: "ChapterSettlementBanner",
    lens: "write",
    role: "章后结算浮动横幅",
    explanation: { what: "结算本章实际回收的伏笔与人物变更", why: "确认本章实际兑现的叙事价值", action: "确认或修正结算结果存入叙事记忆" },
  },

  // ── 镜头 2：理（设定是什么） ──
  {
    panel: "JingweiCanonPanel",
    lens: "lore",
    role: "经纬设定大典总览",
    explanation: { what: "世界观、设定集与权威百科索引", why: "维护全书不可动摇的硬设定基石", action: "浏览或检索全书实体条目" },
  },
  {
    panel: "JingweiEntryEditor",
    lens: "lore",
    role: "经纬词条深度编辑器",
    explanation: { what: "设定词条的层级、属性与别名编辑面板", why: "录入与修正具体设定事实", action: "补充词条背景与约束边界" },
  },
  {
    panel: "CharacterCardPage",
    lens: "lore",
    role: "角色人设卡全景面板",
    explanation: { what: "人物档案、性格谱系、能力值与动机", why: "防止人物性格崩塌，维持角色张力", action: "查阅或编辑角色核心小传" },
  },
  {
    panel: "WorldCardPage",
    lens: "lore",
    role: "世界观设定卡",
    explanation: { what: "地理界域、力量体系与法则设定", why: "约束故事背景的大环境规则", action: "校验或扩展世界观法则" },
  },
  {
    panel: "EntityDetailDrawer",
    lens: "lore",
    role: "实体详情快速抽屉",
    explanation: { what: "点击任何名词快速滑出的百科卡片", why: "无需离开主界面即可核对人名与设定", action: "快速核对或小修实体数据" },
  },
  {
    panel: "StoryTreeView",
    lens: "lore",
    role: "经典故事树视图",
    explanation: { what: "卷-章-场景-人物的树状层级图", why: "总览故事的物理包容骨架", action: "折叠/展开查看层级关系" },
  },
  {
    panel: "CanonicalTreesPanel",
    lens: "lore",
    role: "叙事正统正图（6图合一切换器）",
    explanation: { what: "世界观树/关系树/章节树/发展历程/脉络/总图", why: "全视角理清全书概念与结构脉络", action: "在切换器内自由变换观察视角" },
  },
  {
    panel: "NarrativeMemoryPanel",
    lens: "lore",
    role: "叙事记忆条目审阅面板",
    explanation: { what: "列出各章提取的事实片段与记忆条目", why: "确保章后沉淀的事实准确无误", action: "核准或废弃自动提取的叙事事实" },
  },
  {
    panel: "NarrativeMemorySummary",
    lens: "lore",
    role: "叙事记忆摘要卡",
    explanation: { what: "特定实体的历史经历与演进概要", why: "快速获知人物在全书中的过往经历", action: "查阅角色在各卷各章的轨迹" },
  },
  {
    panel: "CharactersAndLoreSidebarPanel",
    lens: "lore",
    role: "IDE 侧边栏角色与设定导航",
    explanation: { what: "按分类聚拢的角色与设定轻量树", why: "IDE 模式下随手定位设定文件", action: "点击定位或新建设定词条" },
  },
  {
    panel: "JingweiSidebarToolbar",
    lens: "lore",
    role: "设定库管理与检索快捷栏",
    explanation: { what: "快速按类型过滤词条与批量操作", why: "提升庞大设定库的管理检索效率", action: "按类别或层级筛选词条列表" },
  },
  {
    panel: "JingweiEmptyState",
    lens: "lore",
    role: "设定库初始引导",
    explanation: { what: "新书无设定时的创建指引", why: "引导作者建立最初的角色与世界观", action: "点击创建第一个角色或核心设定" },
  },

  // ── 镜头 3：推（下一章写什么） ──
  {
    panel: "StoryProgressBoard",
    lens: "progression",
    role: "故事推进看板（章 × 真剧情线）",
    explanation: { what: "横轴为章、纵轴为剧情线的叙事格点总看板", why: "直观定位下一章焦点并解决伏笔债务", action: "点击空白格规划场景或为剧情线添加节拍" },
  },
  {
    panel: "StoryProgressionCanvas",
    lens: "progression",
    role: "故事推进大屏外壳",
    explanation: { what: "推进看板与权威故事树的双重视角容器", why: "统一承载下一章构思与故事骨架核对", action: "在推进网格与故事树之间切换" },
  },
  {
    panel: "TensionCurvePanel",
    lens: "progression",
    role: "张力波浪曲线图",
    explanation: { what: "展示全书各章的情绪张力与起伏曲线", why: "评估节奏快慢，避免持续平淡或审美疲劳", action: "调整各章节奏起伏预期" },
  },
  {
    panel: "TensionCurveStrip",
    lens: "progression",
    role: "紧凑型张力指示条",
    explanation: { what: "随章吸附的小型情绪张力指示条", why: "不占主屏的情况下监控本章在全书曲线的位置", action: "观察当前章张力强度建议" },
  },
  {
    panel: "ForeshadowingBoard",
    lens: "progression",
    role: "伏笔与悬念看板",
    explanation: { what: "埋伏、暗线与回收状态追踪矩阵", why: "杜绝遗忘烂尾伏笔，控制伏笔债务率", action: "查看待回收伏笔并指派给下一章" },
  },
  {
    panel: "BeatBudgetEditor",
    lens: "progression",
    role: "细纲节拍预算编辑器",
    explanation: { what: "规划下一章的节拍步长、预估字数与爽点分布", why: "让下一章写作具备定量定性的结构骨架", action: "分配开端、发展、高潮的节拍比重" },
  },
  {
    panel: "CharacterArcsPanel",
    lens: "progression",
    role: "角色弧线演化面板",
    explanation: { what: "追踪主角与核心配角的心态变化与阶段目标", why: "确保下一章角色的行为动机符合成长弧线", action: "检查下一章角色状态跃迁目标" },
  },
  {
    panel: "CoreShiftPanel",
    lens: "progression",
    role: "核心矛盾转移指示器",
    explanation: { what: "标识当前卷主矛盾的转移与升级趋势", why: "确保剧情推进始终围绕主要矛盾展开", action: "确认下一章是激化旧矛盾还是引入新矛盾" },
  },
  {
    panel: "StorylineAndPlanningSidebarPanel",
    lens: "progression",
    role: "IDE 侧边栏大纲与推进导航",
    explanation: { what: "分卷大纲、伏笔清单与下一章规划快捷栏", why: "在编写正文时快速对照大纲规划", action: "点击跳至大纲节点或伏笔项" },
  },
  {
    panel: "CreativeCompassPanel",
    lens: "progression",
    role: "创作罗盘（核心驱动力指南）",
    explanation: { what: "全书核心卖点、金手指机制与受众期待定盘星", why: "防止长篇写作中途跑偏核心人设与爽点定位", action: "核对下一章情节是否符合核心受众期待" },
  },
  {
    panel: "LedgerProgressTable",
    lens: "progression",
    role: "叙事台账进度对照表",
    explanation: { what: "章节已完成进度与规划预期的定量比对", why: "监控写作进度与大纲偏离度", action: "校准实际章节与预期台账偏差" },
  },
  {
    panel: "WorkflowTimelinePanel",
    lens: "progression",
    role: "阶段性推进时间线",
    explanation: { what: "推演多线并发事件在故事时间上的交错关系", why: "理清同一时间不同地点角色的行动因果", action: "排布各剧情线在绝对时间轴上的节拍" },
  },

  // ── 镜头 4：审（这章行不行） ──
  {
    panel: "AiTasteReport",
    lens: "audit",
    role: "AI 味检测与去油报告",
    explanation: { what: "扫描文本中的机械陈词、AI 烂梗与套路句式", why: "去除生硬 AI 腔调，让文笔自然通透有网文质感", action: "一键采纳去 AI 味替换建议" },
  },
  {
    panel: "CompliancePanel",
    lens: "audit",
    role: "平台合规与敏感词审查面板",
    explanation: { what: "扫描涉黄、涉政、暴力违禁及敏感词汇", why: "保障章节在番茄、起点等目标平台的过审安全", action: "定位红线内容并进行脱敏改写" },
  },
  {
    panel: "ComplianceViolationCard",
    lens: "audit",
    role: "单条合规违规诊断卡片",
    explanation: { what: "展示单处可疑语段的上下文与违规风险级别", why: "精确呈现为什么违规及建议改写方式", action: "按卡片建议替换违禁词句" },
  },
  {
    panel: "StyleDriftPanel",
    lens: "audit",
    role: "文风漂移度分析面板",
    explanation: { what: "比对当前章与全书基准文风的句长、修辞与语气", why: "防止章节风格忽而文青忽而白话，保持一致性", action: "根据漂移指标调节修辞与句式节奏" },
  },
  {
    panel: "NarrativeConsistencyPanel",
    lens: "audit",
    role: "叙事一致性与逻辑自洽校验面板",
    explanation: { what: "检测战力崩坏、时间错位、生死状态矛盾", why: "防范前后文逻辑硬伤与设定的不自洽", action: "核查矛盾处并修正设定或正文" },
  },
  {
    panel: "BookHealthSummary",
    lens: "audit",
    role: "全书质量健康度总览",
    explanation: { what: "全书合规分、连贯性、张力合格率与伏笔健康度雷达图", why: "全景掌控书稿的整体质量水位", action: "针对偏弱维度开展专项打磨" },
  },
  {
    panel: "GovernanceCockpitPanel",
    lens: "audit",
    role: "创作治理驾驶舱",
    explanation: { what: "综合质量指标与发布门禁审查看板", why: "作为交稿/发版前的最后一站严把质量关", action: "核查门禁检查项并批准发布" },
  },
  {
    panel: "QualityCenterPanel",
    lens: "audit",
    role: "质检中心聚合面板",
    explanation: { what: "聚合 AI 味、合规、一致性与文风的多合一面板", why: "一次性跑完章节质量审查全流程", action: "执行一键全面体检" },
  },
  {
    panel: "QualityPanel",
    lens: "audit",
    role: "轻量单章质检挂件",
    explanation: { what: "单章维度的快速质量分打分面板", why: "码完字立即得知本章质量指标", action: "查看扣分点并针对性修改" },
  },
  {
    panel: "ProblemsPanel",
    lens: "audit",
    role: "IDE 问题诊断底栏",
    explanation: { what: "类似 VS Code Problems，逐条罗列正文中的红波浪线问题", why: "按行列精确跳至错误位置逐一消灭", action: "点击错误条目直接在编辑器定位改错" },
  },

  // ── 基础支撑（资/环境）：归入侧边抽屉或系统级操作，不作为创作主镜头 ──
  {
    panel: "ResourceHistoryPanel",
    lens: "system",
    role: "历史版本对比抽屉",
    explanation: { what: "文档的历史快照与 diff 差异对比", why: "追踪修改轨迹与误删挽救", action: "对比历史差异或回滚到历史版本" },
  },
  {
    panel: "CheckpointPanel",
    lens: "system",
    role: "创作里程碑与安全检查点",
    explanation: { what: "在重大剧情转折前打下的可还原里程碑快照", why: "试验性大改无需担心破坏已有成果", action: "打上检查点标签或一键恢复状态" },
  },
  {
    panel: "CollaborationVersionPanel",
    lens: "system",
    role: "协作与版本合并控制面板",
    explanation: { what: "多端同步与合并冲突解决界面", why: "保障作者在不同设备写作的数据安全", action: "解决冲突并同步最新提交" },
  },
  {
    panel: "RuntimeStatePanel",
    lens: "system",
    role: "底层引擎运行状态诊断器",
    explanation: { what: "叙述者模型心跳、数据库连接与任务队列状态", why: "供排查技术故障与系统性能", action: "查看诊断日志或重启叙述者" },
  },
  {
    panel: "WorkbenchResourceTree",
    lens: "system",
    role: "工作台文件与资源树",
    explanation: { what: "全书目录、分卷、正文与设定文件的树状资源总览", why: "统一组织底层工程文件资产", action: "重命名、归档或拖拽移动资源文件" },
  },
  {
    panel: "BookSettingsPanel",
    lens: "system",
    role: "书籍工程全局设置面板",
    explanation: { what: "书籍基础元数据、字数目标、语言与平台模式设置", why: "定义工程全局行为与校验标准", action: "更新书名、目标字数或平台规则" },
  },
  {
    panel: "NewBookGuide",
    lens: "system",
    role: "新书初始化引导向导",
    explanation: { what: "引导新建书籍、设定基石与第一卷", why: "降低开书门槛，快速启动项目", action: "跟随步骤完成开书基础要素录入" },
  },
  {
    panel: "ImportWizard",
    lens: "system",
    role: "已有书稿反向导入向导",
    explanation: { what: "将本地 txt 或 word 拆分成标准项目分卷", why: "兼容老作者已有资产迁移", action: "上传书稿文件并确认分章规则" },
  },
] as const;

/**
 * 已下线的重复/废弃入口清单（杜绝并存）
 */
export const RETIRED_DUPLICATE_ENTRIES = [
  {
    name: "StoryProgressionCanvas.timeline",
    replacement: "CanonicalTreesPanel (kind='timeline')",
    reason: "与故事树内置的「发展历程」子视图 100% 重复，已按 DoD 彻底下线顶层 Tab，并由 normalizeStoryProgressionView 自动引导",
  },
  {
    name: "StoryProgressionCanvas.chronicle",
    replacement: "CanonicalTreesPanel (kind='chronicle')",
    reason: "与故事树内置的「章节脉络」子视图 100% 重复，已按 DoD 彻底下线顶层 Tab，并由 normalizeStoryProgressionView 自动引导",
  },
  {
    name: "StoryProgressionCanvas.network",
    replacement: "CanonicalTreesPanel (kind='relations')",
    reason: "与故事树内置的「关系树」子视图 100% 重复，已按 DoD 彻底下线顶层 Tab，并由 normalizeStoryProgressionView 自动引导",
  },
  {
    name: "StoryMapCanvas",
    replacement: "StoryProgressBoard / CanonicalTreesPanel",
    reason: "早期力导向图主视觉探索，已证明不符合网文线性叙事直觉，全面收拢进推进看板与权威故事树",
  },
  {
    name: "StoryNeuralCloudCanvas",
    replacement: "CanonicalTreesPanel",
    reason: "无序点云原型，已收拢到 CanonicalTreesPanel",
  },
  {
    name: "ChronicleHelixCanvas",
    replacement: "CanonicalTreesPanel (kind='chronicle')",
    reason: "双螺旋视觉实验，已正式并入 CanonicalTreesPanel(chronicle)",
  },
  {
    name: "NarrativeMemoryGraphWorkspace",
    replacement: "CanonicalTreesPanel (kind='relations') / NarrativeMemoryPanel",
    reason: "早期的重型独立图谱工作台，已下线并收拢为权威正图的关系树与叙事记忆条目审阅",
  },
  {
    name: "StoryTreePanel",
    replacement: "StoryTreeView / CanonicalTreesPanel",
    reason: "故事树旧包装容器，已下线；底层 StoryTreeView 组件保留供对话工具卡渲染",
  },
] as const;

export function getLensForPanel(panelName: string): NarrativeLensId {
  const match = PANEL_CLASSIFICATIONS.find((c) => c.panel === panelName);
  return match?.lens ?? "write";
}

export function getPanelsForLens(lensId: NarrativeLensId): readonly PanelClassification[] {
  return PANEL_CLASSIFICATIONS.filter((c) => c.lens === lensId);
}

export function isPanelInLens(panelName: string, lensId: NarrativeLensId): boolean {
  return getLensForPanel(panelName) === lensId;
}
