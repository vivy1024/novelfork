import type { BeatTemplate } from "../types.js";

export const chapterEndingHooksTemplate: BeatTemplate = {
  id: "chapter-ending-hooks",
  name: "章节结尾钩子生成器",
  description: "用于章末卡点和追读设计的结尾策略库。",
  beats: [
    { index: 1, name: "悬念句", purpose: "用一个未解问题迫使读者点下一章。", wordRatio: 0.1, emotionalTone: "好奇", networkNovelTip: "问题必须具体，不能泛泛写“事情还没结束”。" },
    { index: 2, name: "反转揭示", purpose: "在最后一段改变读者对本章事件的理解。", wordRatio: 0.12, emotionalTone: "震动", networkNovelTip: "反转应有伏笔，不能凭空翻盘。" },
    { index: 3, name: "敌人现身", purpose: "让新压力在章末登场。", wordRatio: 0.1, emotionalTone: "压迫", networkNovelTip: "适合战斗/副本/悬疑章。" },
    { index: 4, name: "奖励露头", purpose: "让宝物、线索、资格只露一角。", wordRatio: 0.1, emotionalTone: "期待", networkNovelTip: "奖励不要立刻兑现，留到下一章处理。" },
    { index: 5, name: "代价到账", purpose: "本章胜利后立刻展示副作用。", wordRatio: 0.12, emotionalTone: "不安", networkNovelTip: "防止爽点过轻，让胜利更有重量。" },
    { index: 6, name: "情感未竟", purpose: "关键关系话只说一半。", wordRatio: 0.1, emotionalTone: "牵挂", networkNovelTip: "适合感情线和群像线。" },
    { index: 7, name: "规则变更", purpose: "宣布考试、榜单、系统、制度规则改变。", wordRatio: 0.12, emotionalTone: "紧张", networkNovelTip: "规则变化天然制造下一章任务。" },
    { index: 8, name: "视角切换", purpose: "用反派/旁观者视角补一刀。", wordRatio: 0.12, emotionalTone: "反差", networkNovelTip: "短，准，不解释过多。" },
    { index: 9, name: "名场面收束", purpose: "用一句有传播性的短句收束本章。", wordRatio: 0.02, emotionalTone: "高光", networkNovelTip: "必须来自本章矛盾，不要硬造金句。" },
    { index: 10, name: "危险倒计时", purpose: "给出明确时间限制。", wordRatio: 0.1, emotionalTone: "急迫", networkNovelTip: "“三天后”“天亮前”“下一轮开始”都比抽象危机有效。" },
  ],
};
