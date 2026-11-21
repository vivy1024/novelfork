/**
 * 叙事写作方法论内核（Craft Doctrine — 模块化可演进知识层）
 *
 * 定位：将经过验证的经典写作方法论拆分为按创作工序命名的结构化规则模块，
 * 统一供给子代理名册（roster.ts）、主系统提示词摘要、工序提示词预设及蓝图/卷纲校验参考。
 *
 * 扩展协议：
 * - 后续每吸收一批新书/新方法论，只需在对应工序域（architecture / scene / character / dialogue / prose / revision / audit）
 *   增量补充或更新模块化规则卡片，并保持各工序面向模型的精炼条数在预算内，不堆砌长篇理论说教。
 */

export type CraftDoctrineDomain =
  | "architecture"
  | "scene"
  | "character"
  | "dialogue"
  | "prose"
  | "revision"
  | "audit";

export interface CraftDoctrinePrinciple {
  readonly id: string;
  readonly domain: CraftDoctrineDomain;
  /** 一句话可执行准则（直接面向写作/审校 Agent，动词开头、无废话）。 */
  readonly directive: string;
  /** 规则演进批次标记（便于后续继续融合新书时追踪来源与版本）。 */
  readonly generation: number;
}

export const CRAFT_DOCTRINE_PRINCIPLES: readonly CraftDoctrinePrinciple[] = [
  // ─── 结构与大纲（architecture） ───
  {
    id: "arch.four-part-checkpoints",
    domain: "architecture",
    directive:
      "按四段结构推进（布局→反应试错→主动进攻→压力锅解决），25% 第一灾难逼出不可回头决定，50% 中点翻转错误前提，75% 仅设唯一一次看似落败，杜绝前后阶段职责错位。",
    generation: 1,
  },
  {
    id: "arch.iceberg-reveals",
    domain: "architecture",
    directive:
      "用「冰山对手 + 递增揭露」打破中盘停滞：对手隐藏层级与秘密反击逐级曝光，每次迫使主角策略「河道转弯」，而非换场景重复同类打斗；围绕中后段转折点倒推前文伏笔，改纲时按层级回溯同步。",
    generation: 1,
  },
  {
    id: "arch.controlling-idea",
    domain: "architecture",
    directive:
      "每卷/全书用「价值+原因」锁定单一主控思想，并从主角首要行动（A）的对立面反推初始弱点（W）与转变方向（C），让正面思想与反思想逐场交锋、动作显露主题而不靠说教。",
    generation: 1,
  },

  // ─── 场景与镜头（scene） ───
  {
    id: "scene.gap-not-activity",
    domain: "scene",
    directive:
      "区分「行动」与「活动」：人物按经验顺遂完成只是空转活动；每场必须劈开「主观期望 vs 客观结果」的鸿沟，引发起止价值电荷真实翻转，严禁起止价值不变的「非事件场」。",
    generation: 1,
  },
  {
    id: "scene.active-reactive",
    domain: "scene",
    directive:
      "交替使用主动场（目标→冲突→挫折）与被动场（反应→困境→价值取舍决定）；每幕只承载单一核心进展，跳过到达/开门/寒暄等过场，在冲突临界点的最后时刻深切入。",
    generation: 1,
  },
  {
    id: "scene.info-asymmetry",
    domain: "scene",
    directive:
      "按知情落差主动切换悬念（读者与主角同步不知结果）、神秘（读者知更少，禁用扣押正常信息的虚假神秘）与戏剧反讽（读者先知陷阱），以悬念为主干骨架、局部穿插反讽放大张力。",
    generation: 1,
  },

  // ─── 人物塑造（character） ───
  {
    id: "char.value-chain-3d",
    domain: "character",
    directive:
      "关键行为必须向上追溯至「价值观→抱负→具体目标」；人物分三维——一维表象面具、二维过往创伤与借口（反派在自己的故事里同样自视合理）、三维高压下的高代价自由两难抉择。",
    generation: 1,
  },
  {
    id: "char.cast-contrast",
    domain: "character",
    directive:
      "卡司按复杂度分层（核心主角与主要对手多维立体，次要对手形成不同攻击角度且彼此亦冲突的四角对立，外围配角单特征鲜明）；不靠自我表白立人设，靠高风险两难选择见真相。",
    generation: 1,
  },

  // ─── 对白与潜台词（dialogue） ───
  {
    id: "dlg.triangular-subtext",
    domain: "dialogue",
    directive:
      "先保证删掉对白仅靠行动就能看懂局面变化，再按故事轨/价值轨/声线轨打磨台词；直白摊牌写僵时引入「第三者」（旁人/物件/暗桩）改写为三边对话，嘴上争表象、底下砍软肋。",
    generation: 1,
  },

  // ─── 叙述语言与视角（prose） ───
  {
    id: "prose.pov-and-sketch",
    domain: "prose",
    directive:
      "限知 POV 绝不写视角角色此刻看不见的自己（如「她抬起羞怯的眼睛」），切换视角必有理由与分段路标；描写用粗略类比与核心特征留白，拒绝参数说明书，同一地点不重复详写。",
    generation: 1,
  },
  {
    id: "prose.adverbs-and-rhythm",
    domain: "prose",
    directive:
      "前文已交代情绪力度则删冗余副词，把弱修饰收进精准动词与名词，清理叙事段「大概/或许/稍稍/非常」弱化词；用标点休止符与长短句对比控制叙事流，删无意回声、留有意增量重复。",
    generation: 1,
  },

  // ─── 返修与裁剪（revision） ───
  {
    id: "rev.two-layer-and-leap",
    domain: "revision",
    directive:
      "表层润色（去副词、调标点韵律、改三边对白）与深层改因果/价值翻转分开处理；压缩时删解释性肿块与空转过场，敢做时间与信息跳跃，不洗掉人声指纹与压迫来源。",
    generation: 1,
  },

  // ─── 审校诊断（audit） ───
  {
    id: "audit.five-step-scene",
    domain: "audit",
    directive:
      "对发闷或牵强场景跑五步诊断：① 驱动者与对抗欲望是否正面相对；② 标开端价值正负；③ 按潜文本行为拆节拍（同类重复只算一拍）；④ 查结尾价值是否真翻转（不变即非事件）；⑤ 定位期望与结果裂开鸿沟的转折点。",
    generation: 1,
  },
  {
    id: "audit.ideal-reader",
    domain: "audit",
    directive:
      "以理想读者视角标出走神停顿段，并明确区分两类病因：「作者懂但没写清（补交代）」与「因果/设定本身没想透（需重构）」。",
    generation: 1,
  },
];

/** 按工序域取出方法论准则文本，供子代理、工作流预设与系统提示统一复用。 */
export function selectCraftDoctrineLines(
  domains: readonly CraftDoctrineDomain[],
  ids?: readonly string[],
): string[] {
  const domainSet = new Set(domains);
  const idSet = ids ? new Set(ids) : null;
  return CRAFT_DOCTRINE_PRINCIPLES
    .filter((item) => domainSet.has(item.domain) && (!idSet || idSet.has(item.id)))
    .map((item) => item.directive);
}
