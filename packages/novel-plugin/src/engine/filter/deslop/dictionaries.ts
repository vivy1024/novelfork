/**
 * 去 AI 味的确定性改写词表与句式表。
 *
 * 收词标准：**删掉之后句子仍然通顺、且不丢任何叙事信息**。凡是删掉会留下
 * 语法断口的词（例如「仿佛」后面还跟着比喻本体），一律走 `PHRASE_PATTERNS`
 * 做整段替换，而不是放进 `DELETABLE_TERMS`。
 */

/** 直接删除即可的套词：删掉后语法完整、语义不减。 */
export const DELETABLE_TERMS: readonly string[] = [
  "不禁",
  "不由自主地",
  "不由自主",
  "不由得",
  "情不自禁地",
  "情不自禁",
  "自然而然地",
  "自然而然",
  "只见",
  "此时此刻",
  "与此同时",
  "映入眼帘",
  "不易察觉地",
  "不易察觉",
  "几不可闻地",
  "微不可察地",
];

/** 弱化副词：按密度预算删除超额部分，不做零容忍。 */
export const WEAK_ADVERBS: readonly string[] = ["缓缓", "微微", "轻轻", "淡淡"];

export interface PhrasePattern {
  readonly rule: string;
  readonly pattern: RegExp;
  /** 用捕获组重组；返回空串表示删除整段。 */
  readonly replace: (match: RegExpMatchArray) => string;
  readonly reason: string;
}

/** 需要整段重组的确定性句式。 */
export const PHRASE_PATTERNS: readonly PhrasePattern[] = [
  {
    rule: "negation-reversal",
    // 「不是A，而是B」/「不是A，是B」→ 只留 B
    pattern: /不是[^。！？；，]{1,30}[，,]\s*(?:而)?是([^。！？；]{1,40})/gu,
    replace: (match) => match[1] ?? "",
    reason: "否定翻转句式是最典型的 AI 议论腔，直接写后项即可",
  },
  {
    rule: "eye-flash",
    // 「眼中闪过一丝X」→「他垂下眼」这类需要主语，规则不猜主语，只删修饰段
    pattern: /眼(?:中|里)闪过(?:一丝|一抹|些许)?[^，。！？；]{0,8}/gu,
    replace: () => "垂下眼",
    reason: "AI 表情套词，改成可见动作",
  },
  {
    rule: "mouth-curl",
    pattern: /嘴角(?:勾起|微扬|上扬)(?:一抹|一丝)?[^，。！？；]{0,8}/gu,
    replace: () => "嘴角一扯",
    reason: "AI 表情套词，改成可见动作",
  },
  {
    rule: "deep-breath",
    pattern: /深吸(?:了)?一口气[，,]?\s*/gu,
    replace: () => "",
    reason: "AI 动作套词，删除后不丢信息",
  },
  {
    rule: "heart-surge",
    pattern: /心(?:中|头|底)(?:涌起|泛起)(?:一股|一阵|一丝)?[^，。！？；]{0,8}/gu,
    replace: () => "胸口一紧",
    reason: "心理告知套词，改成身体反应",
  },
  {
    rule: "simile-suffix",
    // 「仿佛/犹如/宛若 …… 一般/一样」→ 去掉比喻外壳，保留本体
    pattern: /(?:仿佛|犹如|宛若|宛如)([^，。！？；]{1,20})(?:一般|一样|似的)/gu,
    replace: (match) => match[1] ?? "",
    reason: "文言比喻外壳，去壳保留本体",
  },
];

/** 标点规范化：省略号与破折号在正文里没有功能，统一收敛。 */
export const PUNCTUATION_RULES: readonly PhrasePattern[] = [
  {
    rule: "ellipsis",
    pattern: /[。，]?(?:……|…|\.{3,}|。{3,})/gu,
    replace: () => "。",
    reason: "省略号停顿没有叙事功能，收敛为句号",
  },
  {
    rule: "em-dash",
    pattern: /\s*(?:——|—|--)\s*/gu,
    replace: () => "，",
    reason: "破折号在正文里改为逗号承接",
  },
  {
    rule: "exclamation-spam",
    pattern: /[！!]{2,}/gu,
    replace: () => "！",
    reason: "感叹号堆砌收敛为一个",
  },
];
