/**
 * 中文 AI 味规则集。
 *
 * 分两类，语义不同，不要混用：
 * - blocking：确定性句式，真人写作几乎不出现，命中即应改写。
 * - advisory：密度型信号。单次出现是正常中文，聚集才是模板腔，因此只报密度不报单点。
 *
 * 纪律：本文件只描述「怎么判定」，不决定「拦不拦」。
 * 是否阻断保存由调用方按分档结果决定，避免规则层偷偷改变产品行为。
 */

export type ZhFlavorSeverity = "blocking" | "advisory";

export interface ZhFlavorRule {
  readonly id: string;
  readonly severity: ZhFlavorSeverity;
  /** 作者可读的问题名 */
  readonly label: string;
  readonly pattern: RegExp;
  /** 命中几次才算问题（advisory 用；blocking 恒为 1） */
  readonly minHits?: number;
  /** 只在文末窗口内检测（章尾腔类规则） */
  readonly tailOnly?: boolean;
  readonly suggestion: string;
}

/**
 * blocking：毒句式。
 * 这些是「一眼就是 AI」的结构，按毒性从高到低排列。
 */
export const BLOCKING_RULES: ReadonlyArray<ZhFlavorRule> = [

  {
    id: "reverse-not-is",
    severity: "blocking",
    label: "「是A，不是B」反序对比",
    // 排除「还是/只是/就是/总是」等合成词误伤
    pattern: /(?<![还只就总不])是([^。，！？\n]{1,12})[，,]\s*(?:而)?不是/gu,
    suggestion: "同上，删掉对比框架只留一侧。",
  },
  {
    id: "voice-contrast",
    severity: "blocking",
    label: "无情绪声线（声音不大却…）",
    pattern: /声音(?:并)?不[大高响亮][^。！？\n]{0,16}[却但偏]/gu,
    suggestion: "改为具体的音量、语速或动作，不要用「不X却Y」的反差公式。",
  },
  {
    id: "negation-parade",
    severity: "blocking",
    label: "否定排比（没有…没有…）",
    pattern: /(?:没有[^，,。！？\n]{1,12}[，,]){2}/gu,
    suggestion: "保留一个否定，其余改成正面描写实际存在的东西。",
  },
  {
    id: "trailer-ending",
    severity: "blocking",
    label: "章尾预告腔",
    pattern: /(?:没人知道|谁也没想到|殊不知|才刚刚开始|拉开序幕|即将来临|他不知道的是|她不知道的是)/gu,
    tailOnly: true,
    suggestion: "章尾用动作、物件或未解决的问题收尾，不要替读者预告后续。",
  },
  {
    id: "trailer-summary",
    severity: "blocking",
    label: "章尾盖章式总结",
    pattern: /(?:这一(?:夜|天|刻|战)[^。！？\n]{0,20}注定|命运[^。！？\n]{0,8}齿轮|新的(?:篇章|人生|旅程)[^。！？\n]{0,10}开始)/gu,
    tailOnly: true,
    suggestion: "删掉升华句。让读者自己感受重量。",
  },
];

/**
 * advisory：密度型。
 * 阈值单位是「次/千字」，分母为遮罩后的叙述层字数。
 */
export const ADVISORY_RULES: ReadonlyArray<ZhFlavorRule> = [
  {
    id: "not-is-comparison",
    severity: "advisory",
    label: "「不是A，而是B」对比句",
    /**
     * 曾设为 blocking，被 915 章真人语料否掉：即使收紧到必须带「而是」，
     * 真人仍有 12%（126 次）命中，且样例都是正常中文。
     * 它是「密度型」而非「确定性错误」——偶尔用无妨，连用才像 AI。
     */
    pattern: /不是[^。！？\n]{1,24}[，,]\s*而是[^。！？\n]{1,24}/gu,
    minHits: 2,
    suggestion: "单次使用没问题；同章多次出现时删掉对比框架，只留「而是」后半句。",
  },
  {
    id: "weak-adverb-density",
    severity: "advisory",
    label: "弱化副词堆积",
    pattern: /(?:缓缓|微微|轻轻|淡淡|悄悄|静静)/gu,
    minHits: 3,
    suggestion: "合计控制在 3 次/千字以内。多数可直接删，或换成具体动作幅度。",
  },
  {
    id: "cliche-modifier",
    severity: "advisory",
    label: "套路化修饰",
    pattern: /(?:一丝|一抹|些许|几分|隐约)/gu,
    minHits: 3,
    suggestion: "「一丝笑意」这类量词修饰是典型 AI 腔，删掉量词或改写为动作。",
  },
  {
    id: "body-cliche",
    severity: "advisory",
    label: "身体反应陈词",
    pattern: /(?:深吸一口气|眼中闪过|嘴角勾起|嘴角微扬|瞳孔微缩|指节泛白|心中一动|心头一震|心中一凛|脸色一变)/gu,
    // 语料校准：阈值 2 时真人命中 15%（含「心中暗道」这类常规内心戏），上调到 4 并移出「心中暗道」
    minHits: 4,
    suggestion: "换成这个角色特有的身体反应，不要用通用模板。",
  },
  {
    id: "simile-density",
    severity: "advisory",
    label: "比喻词密度过高",
    pattern: /(?:仿佛|犹如|宛若|宛如|如同)/gu,
    minHits: 3,
    suggestion: "抽象比喻（像命运的齿轮）优先删；生活化比喻可留但不要连用。",
  },
  {
    id: "reasoning-chain",
    severity: "advisory",
    label: "判断链聚集",
    pattern: /(?:他知道|她知道|这意味着|这说明|显然|原来)/gu,
    minHits: 4,
    suggestion: "因果交给动作和对话去拼，不要由叙述者逐条判断。",
  },
  {
    id: "micro-action-tic",
    severity: "advisory",
    label: "微动作尾巴（了一下/了下）",
    pattern: /了(?:一)?下/gu,
    minHits: 5,
    suggestion: "这是去 AI 味过头产生的反向指纹。合并动作，不要每个动作都接反应尾巴。",
  },
  {
    id: "significance-inflation",
    severity: "advisory",
    label: "意义膨胀",
    pattern: /(?:意义深远|前所未有|可谓|堪称|不容置疑|不易察觉|显而易见)/gu,
    minHits: 2,
    suggestion: "删掉评价，只留事实。让读者判断重要性。",
  },
  {
    id: "em-dash-density",
    severity: "advisory",
    label: "破折号密度",
    /**
     * 只认中文破折号，不认英文 `--`（真人稿里那是分隔线/省略）。
     * 语料校准：破折号是作者文风取向而非 AI 特征（真人 100% 章节在用），
     * 因此只做高密度提示，绝不阻断。
     */
    pattern: /——|(?<![-\s])—(?![-\s])/gu,
    minHits: 6,
    suggestion: "破折号本身没问题；密度过高时可把部分改成独立短句或逗号。",
  },
];

export const ALL_RULES: ReadonlyArray<ZhFlavorRule> = [...BLOCKING_RULES, ...ADVISORY_RULES];
