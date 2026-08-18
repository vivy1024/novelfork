/**
 * 需要语义判断、规则不得自动改写的项，只标注并给出可执行指示。
 *
 * 判定边界：凡是「改写需要知道上下文里发生了什么」的，都在这里。规则引擎
 * 不猜主语、不编动作、不删可能承担叙事功能的句子。
 */

export interface ManualRule {
  readonly rule: string;
  readonly pattern: RegExp;
  readonly reason: string;
  readonly instruction: string;
}

export const MANUAL_RULES: readonly ManualRule[] = [
  {
    rule: "emotion-telling",
    pattern: /(?:他|她|它)(?:感到|觉得|感觉到)[^，。！？；]{0,12}/gu,
    reason: "直接告知情绪，需要换成身体反应或现场动作",
    instruction: "把这处情绪告知改成可见的身体反应或当下动作（手在抖 / 把烟掐灭 / 半天没迈进门），不要换成另一个情绪形容词。",
  },
  {
    rule: "omniscient-spoiler",
    pattern: /(?:(?:他|她)不知道的是|殊不知|多年以后|冥冥之中|仿佛预示着)/gu,
    reason: "上帝视角剧透，跳出了角色当下的认知范围",
    instruction: "删掉这处上帝视角旁白。悬念留给读者自己悬，只写角色此刻知道的。若删后信息断裂，用角色能看到的物件或动静补。",
  },
  {
    rule: "ending-sublimation",
    pattern: /(?:终于(?:明白|意识到|懂了)|这才(?:明白|意识到)|这一刻[^。！？]{0,20}(?:明白|懂|知道))/gu,
    reason: "总结升华句，把意义说满了",
    instruction: "删掉这处定性总结，改用角色当下要处理的具体缺口、未完成动作或局部反馈收束，不要在段尾另补人味尾巴。",
  },
  {
    rule: "causal-explanation",
    pattern: /(?:之所以[^，。！？；]{1,30}是因为|这(?:意味着|说明)|原来[^，。！？；]{1,20})/gu,
    reason: "解释因果，作者跳出来讲解",
    instruction: "删掉因果解释，让读者从动作、对话和反应里自己拼。若这句承担了小连贯，压成角色当下的白话念头或物件状态。",
  },
  {
    rule: "essay-structure",
    pattern: /(?:首先|其次|再者|最后|综上所述|由此可见|不难看出|值得注意的是)/gu,
    reason: "论文体结构词出现在小说正文里",
    instruction: "删掉论文体连接词，用动作顺序或场景切换自然承接。",
  },
];

/** 连续同主语开头需要重写句首，规则不猜怎么改，只定位。 */
export const CONSECUTIVE_SUBJECTS: readonly string[] = [
  "他", "她", "它", "他们", "她们", "然后", "于是", "接着",
];

export const CONSECUTIVE_SUBJECT_INSTRUCTION =
  "这几句连续用同一个词开头，读起来像流水账。用场内物件、声音、局部身体或环境反馈换开句首，不要滥用死物拟人，也不要为了变化写油腻倒装。";
