/**
 * 星月级工序提示词预设库（Step Prompt Presets）
 *
 * 为工作流画布中的不同工序类别（guided-plan / writer-generate / audit / adversarial-audit /
 * outline-plan / custom-tool / context-load / post-settlement / canvas-open）提供一键套用的高质量领域指令。
 * 只提供创作方法论、视听转译与审读标尺，不包含任何第三方闭源/受限许可证提示词原文。
 */

import type { NovelWorkflowStepKind } from "./novel-workflows.js";

export interface StepPromptPreset {
  readonly id: string;
  readonly label: string;
  readonly categoryLabel: string;
  /** 优先推荐给哪些工序类别；为空或未命中时也可在「全部预设」中选用。 */
  readonly kinds: readonly NovelWorkflowStepKind[];
  readonly summary: string;
  readonly prompt: string;
}

export const STEP_PROMPT_PRESETS: readonly StepPromptPreset[] = [
  {
    id: "tomato-golden-opening-blueprint",
    label: "番茄黄金三章快节奏蓝图",
    categoryLabel: "蓝图规划",
    kinds: ["guided-plan"],
    summary: "前300字落具体困境，每500字设抓点，章末强悬停钩子",
    prompt:
      "按免费阅读高完读率节奏拟本章镜头蓝图：① 第一场前 300 字内直接切入主角眼前的具体困境或利益冲突，禁止世界观说明或回忆开篇；② 场景推进每 500–800 字安排一次信息增量、反击或局势反转；③ 明确标注本章兑现的小爽点及其前置压抑铺垫；④ 章末必须停在未完成动作、半截关键信息或突发变故上。",
  },
  {
    id: "high-density-causal-card",
    label: "高密度因果控制卡（强动机链）",
    categoryLabel: "蓝图规划",
    kinds: ["guided-plan"],
    summary: "锁定人物筹码、场景博弈、信息差与代价预算",
    prompt:
      "以高密度因果控制卡规格制定本章蓝图：逐场写明【视角人物当下筹码与怕失去之物】【本场对手及不可退让的争夺焦点】【读者已知 vs 角色未知的信息差】【本场结束后的处境位移与付出代价】。严禁无因果推进的纯过渡场景，所有伏笔埋设须指明可见物象与预期回收方向。",
  },
  {
    id: "suspense-reversal-blueprint",
    label: "短篇高压虐渣与反转蓝图",
    categoryLabel: "蓝图规划",
    kinds: ["guided-plan"],
    summary: "情绪蓄压到临界点后亮底牌反转，配角反应分层",
    prompt:
      "围绕高压情绪拉扯设计本章场景：① 前半段集中叠加不公对待、误解或倒计时危机，让读者站队情绪拉满，主角暗中完成证据或筹码闭环；② 中后段安排一次干净利落的事实亮牌，不做长篇说教；③ 明确规划在场不同立场配角的差异化反应；④ 结尾抛出更高一层真相缺口。",
  },
  {
    id: "qidian-veteran-steady-prose",
    label: "起点老白沉稳叙事起草",
    categoryLabel: "正文执笔",
    kinds: ["writer-generate"],
    summary: "限知视角沉浸感、细节质感落地、权谋博弈潜台词",
    prompt:
      "以沉稳冷峻的老白向笔法起草本章正文：① 严格守住当前视角人物的感知边界，把制度规则、战力差距化进器物细节、行止规矩与环境氛围，不写说明书式旁白；② 对白讲求身份分寸与潜台词，上位者言简意赅，博弈双方不互相解释已知背景；③ 长短句随呼吸节奏错落，克制使用感叹号与夸张形容词。",
  },
  {
    id: "tomato-fast-paced-prose",
    label: "番茄短段落强反馈执笔",
    categoryLabel: "正文执笔",
    kinds: ["writer-generate"],
    summary: "手机端短段落排版、动作对白驱动、零废话高完读",
    prompt:
      "按手机端高完读率形态起草正文：① 段落控制在 1–4 行以内，多用动作与对白直接推动事件，少用静态景物铺陈；② 情绪一律写成生理反应与当场动作，严禁「他心想 / 心中暗道 / 深吸一口气 / 嘴角勾起」等套话；③ 打脸或破局场面先写对手嚣张筹码，再用一句话或一个动作砸实结果；④ 章末最后一句直接悬停在冲突临界点。",
  },
  {
    id: "surgical-revision-keep-voice",
    label: "精准手术刀返修（保声口不扩水）",
    categoryLabel: "正文执笔",
    kinds: ["writer-generate"],
    summary: "逐条落实上游审校意见，不洗平人声指纹与剧情张力",
    prompt:
      "以底稿为基础做精准手术刀式返修：① 逐条核对并修复上游审校指出的硬伤、逻辑漏洞与 AI 腔套话，未报错的精妙段落保持原貌；② 把概括性心理描写替换为具体可拍的肢体动作与器物交互；③ 保留角色原有的口头禅、冷幽默与句式指纹，严禁把棱角分明的文风洗成平庸温吞的公文腔。",
  },
  {
    id: "sharp-editor-retention-audit",
    label: "毒舌主编追读力审读",
    categoryLabel: "审校把关",
    kinds: ["audit", "adversarial-audit"],
    summary: "严查黄金前300字、中段塌陷、憋屈过头与假钩子",
    prompt:
      "以商业平台签约主编的严苛标准审读本章正文：① 前 300 字是否有实质冲突或悬念抓手，哪里会让手机读者三秒划走；② 中段是否存在水字数的重复寒暄、无效移动或设定背书；③ 主角受挫是否有底牌预期托底，有无无意义的憋屈降智；④ 章末钩子是否真能逼人点下一章。每个问题标明段落原句与可执行改法，出现致命劝退点直接判不通过。",
  },
  {
    id: "jinjiang-emotional-tension-audit",
    label: "晋江情感拉扯与CP张力审读",
    categoryLabel: "审校把关",
    kinds: ["audit", "adversarial-audit"],
    summary: "审视眼神动作试探、口是心非推拉感与人设苏感",
    prompt:
      "聚焦人物情感张力与关系推拉审读本章：① 核心角色互动是否有「克制中的失控、试探中的退缩」，还是直白干瘪地喊口号表白；② 肢体距离、视线交错、停顿留白是否承载了未说出口的潜台词；③ 双方的魅力点（苏感/破碎感/清醒独立）是否通过具体选择立住，有无油腻套路或人设漂移。定位具体原句并给出张力升级建议。",
  },
  {
    id: "canon-continuity-hard-audit",
    label: "经纬正典与时间线铁律核查",
    categoryLabel: "审校把关",
    kinds: ["audit", "adversarial-audit"],
    summary: "逐项比对经纬设定、角色知识边界、伤势道具与战力天花板",
    prompt:
      "对照本书经纬设定与近章叙事记忆做硬核连续性核查：① 角色是否说出了按当前时间点不可能知道的情报（知识越界）；② 伤势、灵力/体力消耗、持有道具、地理位置是否与上一章结尾严丝合缝；③ 战力表现与规则代价是否突破已确立的世界观上限；④ 人物行为是否违背其核心动机与绝不清单。任何正典冲突一律标为 error。",
  },
  {
    id: "zero-context-deai-audit",
    label: "四维去AI味与元信息泄漏严查",
    categoryLabel: "审校把关",
    kinds: ["audit", "adversarial-audit"],
    summary: "排查高频套话、等长排比句、总结升华腔与工程词泄漏",
    prompt:
      "专项排查 AI 写作病灶与工程语言泄漏：① 高频套话（不禁、竟然、仿佛、与此同时、眸光微闪、空气仿佛凝固）；② 句长段长机械均匀、三连排比滥用、段尾强行点题升华；③ 用抽象情绪词替代具体动作反应；④ 正文混入「本章、上一章、伏笔、铺垫、读者」等元信息泄漏。逐条摘录原句定位并分级。",
  },
  {
    id: "golden-first-volume-outline",
    label: "黄金开书契约与首卷10章推演",
    categoryLabel: "大纲推演",
    kinds: ["outline-plan"],
    summary: "确立核心卖点契约，排布第1-3章留存爆点与第10章小高潮",
    prompt:
      "围绕新书首卷立项推演前 10 章大纲：① 一句话钉死本书对读者的核心爽点契约与差异化卖点；② 第 1–3 章严格按「具体绝境 → 带代价的破局金手指 → 掀开更大危机」排布黄金三章留存链；③ 第 4–7 章推进主线小闭环并埋下首卷核心伏笔；④ 第 8–10 章完成首轮身份/实力跃迁小高潮，为首秀验证留足追读钩子。",
  },
  {
    id: "midgame-foreshadow-payoff-outline",
    label: "中盘防崩与伏笔清债推演",
    categoryLabel: "大纲推演",
    kinds: ["outline-plan"],
    summary: "优先排期临近/超期伏笔，编排大小爽点交替与地图换挡",
    prompt:
      "针对连载中盘推演后续 5–10 章大纲：① 优先盘点台账中临近或超期未收的伏笔，将其自然编入后续章节冲突中回收，不硬塞结账清单；② 按「小爽点每 1–2 章、阶段大回报在批次末章」排布节奏，避免连续三章纯铺垫；③ 明确每章的场景位移、人物关系变化与章末悬念类型轮换，严禁底牌提前透支。",
  },
  {
    id: "short-drama-storyboard-breakdown",
    label: "短剧/AI漫剧视听分镜拆解",
    categoryLabel: "多模态改编",
    kinds: ["custom-tool", "canvas-open"],
    summary: "输出场次表、人物锁脸视觉锚点、景别运镜与AI生图/视频Prompt",
    prompt:
      "将本章小说改编为竖屏短剧 / AI 漫剧可执行分镜剧本：① 提取出场角色的固定视觉锁脸锚点（年龄外貌、发型发色、标志性服饰与道具）；② 按 60–90 秒单集卡点切分场次，前 3 秒第一镜必须有强视觉冲击或悬念动作；③ 逐镜输出【镜号｜景别｜运镜｜画面动态描述｜角色台词与潜台词语气｜音效BGM｜英文/中文 AI 画面生成提示词】；④ 严守原著人物设定。",
  },
  {
    id: "multi-role-audiobook-script",
    label: "多角色有声书情绪配音台本",
    categoryLabel: "多模态改编",
    kinds: ["custom-tool", "canvas-open"],
    summary: "旁白与角色台词逐句切分，绑定声线档案、呼吸停顿与环境音效",
    prompt:
      "将本章正文切分为多角色 AI 有声书 / 广播剧演播台本：① 对照已确认的角色声线档案列出本集配音表（音色、年龄感、语速基调）；② 不漏改原文词句，逐段拆分为「旁白」与对应角色台词；③ 为关键台词标注【情绪状态｜重音与停顿节奏（如 [停顿0.5s]、[压低声音]）｜呼吸笑叹气口｜环境音效提示】；④ 旁白保持叙事克制，把戏剧张力留给角色对白。",
  },
  {
    id: "context-preflight-strict-check",
    label: "写前全量快照与门禁深检",
    categoryLabel: "上下文与结算",
    kinds: ["context-load", "post-settlement"],
    summary: "核查写前召回包、到期伏笔与上章断点，缺关键设定立即报阻塞",
    prompt:
      "依次装载全书概览、写前预检召回包、出场人物设定与近章叙事记忆：重点核对上一章结尾停在哪个动作瞬间、当前有哪些到期伏笔待回应、视角角色目前持有哪些筹码与伤势限制。若发现卷纲缺失或前章存在严重未决冲突，如实报告阻塞原因与建议动作，不盲目往下硬写。",
  },
  {
    id: "mckee-five-step-scene-audit",
    label: "五步场景诊断与鸿沟精审",
    categoryLabel: "审校把关",
    kinds: ["audit", "adversarial-audit"],
    summary: "逐场查价值翻转、期望鸿沟、潜文本节拍与非事件场，揪出热机过场",
    prompt:
      "按五步场景分析法严审本章每个场景：① 核对驱动者与对抗力量的欲望是否正面相对（而非擦肩相切）；② 标注开场与结尾的价值电荷——若起止价值无变化直接判为「非事件场」并建议合并或改写；③ 按潜文本行为模式拆节拍，指出原地打转的重复拍；④ 定位主观期望与客观结果裂开「鸿沟」的转折点；⑤ 揪出未在最后时刻深切入的到达/寒暄过场，并按理想读者视角区分「没写清（补交代）」与「没想透（改因果）」。",
  },
  {
    id: "triangular-subtext-dialogue-polish",
    label: "三边对话与动作先导精修",
    categoryLabel: "正文执笔",
    kinds: ["writer-generate"],
    summary: "先验无对白行动骨架，引入第三者破解直白摊牌，去冗余副词",
    prompt:
      "以三轨对话与极简散文标准打磨本章：① 先检查删掉对白后仅靠角色动作能否看懂局面位移，删去替行动解说的台词；② 遇到双方正面直白摊牌、台词像辩论稿的段落，引入「第三者」（旁人、物件、暗桩或共同制约）改写为三边对话，嘴上争表象、底下砍软肋；③ 严守限知 POV，删除角色此刻看不见的自我神情描写；④ 清理前文已交代过的冗余副词与叙事段弱化词，用精准动词和标点停顿控住节奏。",
  },
  {
    id: "four-part-iceberg-outline",
    label: "四段灾难坐标与冰山对手推演",
    categoryLabel: "大纲推演",
    kinds: ["outline-plan"],
    summary: "以主控思想为筛子，排布四段支点、四角对立与递增揭露打破中盘停滞",
    prompt:
      "按长篇叙事工程推演后续卷章大纲：① 用「价值+原因」锁定本卷单一主控思想，并核对主角初始弱点（W）是否站在首要行动（A）的对立面；② 将章节落入四段盒子坐标（布局→25%第一灾难逼决定→反应试错→50%中点翻转错误前提→主动进攻→75%唯一一次看似落败→压力锅终局对决）；③ 用冰山对手的递增揭露与四角对立冲突迫使主角策略「河道转弯」，围绕中后段转折点倒推前文伏笔。",
  },
];

/**
 * 返回适合当前工序类别的提示词预设：匹配的排在前面，其余预设归在后面供跨类别借用。
 */
export function getStepPromptPresetsForKind(kind: NovelWorkflowStepKind): {
  readonly recommended: readonly StepPromptPreset[];
  readonly others: readonly StepPromptPreset[];
} {
  const recommended = STEP_PROMPT_PRESETS.filter((preset) => preset.kinds.includes(kind));
  const others = STEP_PROMPT_PRESETS.filter((preset) => !preset.kinds.includes(kind));
  return { recommended, others };
}
