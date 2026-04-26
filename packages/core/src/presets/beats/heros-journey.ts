import type { BeatTemplate } from "../types.js";

export const herosJourneyTemplate: BeatTemplate = {
  id: "heros-journey",
  name: "英雄之旅 17 阶段",
  description: "基于坎贝尔《千面英雄》的启程-启蒙-回归结构，适合成长、穿越、冒险、升级型长篇。",
  beats: [
    { index: 1, name: "历险的召唤", englishName: "Call to Adventure", purpose: "打破旧生活，提出主角必须回应的问题。", wordRatio: 0.04, emotionalTone: "不安", networkNovelTip: "对应穿越、退婚、灭门、系统觉醒等开局钩子。" },
    { index: 2, name: "拒绝召唤", englishName: "Refusal of the Call", purpose: "展示主角的恐惧、惰性或现实牵绊。", wordRatio: 0.03, emotionalTone: "犹豫", networkNovelTip: "让读者看到主角不是工具人，而是有代价的人。" },
    { index: 3, name: "超自然助力", englishName: "Supernatural Aid", purpose: "引入金手指、导师、道具或关键规则。", wordRatio: 0.05, emotionalTone: "惊异", networkNovelTip: "金手指必须带限制，避免无成本开挂。" },
    { index: 4, name: "过第一道门槛", englishName: "Crossing the First Threshold", purpose: "主角正式进入新世界或新阶层。", wordRatio: 0.05, emotionalTone: "紧张", networkNovelTip: "可对应入宗门、进学院、进副本、第一次任务。" },
    { index: 5, name: "鲸鱼之腹", englishName: "Belly of the Whale", purpose: "旧身份被吞没，主角必须重塑自我。", wordRatio: 0.05, emotionalTone: "压迫", networkNovelTip: "适合安排第一次大失败或身份断裂。" },
    { index: 6, name: "考验之路", englishName: "Road of Trials", purpose: "连续小考验训练能力并铺设伙伴/敌人。", wordRatio: 0.2, emotionalTone: "推进", networkNovelTip: "网文中可拆成数个小副本，每个副本给一个收益。" },
    { index: 7, name: "与女神相遇", englishName: "Meeting with the Goddess", purpose: "遇到理想、爱、信念或完整自我的象征。", wordRatio: 0.04, emotionalTone: "温暖", networkNovelTip: "不必是恋爱，可是师承、道心、故乡愿景。" },
    { index: 8, name: "诱惑", englishName: "Woman as Temptress", purpose: "用捷径、权力、欲望考验主角。", wordRatio: 0.04, emotionalTone: "摇摆", networkNovelTip: "让主角拒绝容易胜利，强化价值观。" },
    { index: 9, name: "与父和解", englishName: "Atonement with the Father", purpose: "面对权威、父辈、制度或命运本身。", wordRatio: 0.06, emotionalTone: "对抗", networkNovelTip: "打脸不是目的，完成与权威关系的转化才是。" },
    { index: 10, name: "神化", englishName: "Apotheosis", purpose: "主角认知跃迁，理解更高层规则。", wordRatio: 0.06, emotionalTone: "顿悟", networkNovelTip: "适合境界突破、真相揭露、道心成形。" },
    { index: 11, name: "终极恩赐", englishName: "Ultimate Boon", purpose: "获得足以改变局势的能力、知识或盟友。", wordRatio: 0.06, emotionalTone: "高昂", networkNovelTip: "收益要回收前文代价，不能凭空掉落。" },
    { index: 12, name: "拒绝回归", englishName: "Refusal of the Return", purpose: "主角不愿或不能回到原世界。", wordRatio: 0.04, emotionalTone: "迟疑", networkNovelTip: "可表现为沉迷新力量、逃避责任、无法面对故人。" },
    { index: 13, name: "超自然逃亡", englishName: "Magic Flight", purpose: "带着恩赐逃离追杀或反噬。", wordRatio: 0.07, emotionalTone: "惊险", networkNovelTip: "高潮后的追杀能避免奖励过轻。" },
    { index: 14, name: "外界营救", englishName: "Rescue from Without", purpose: "外部关系证明主角不是孤立获胜。", wordRatio: 0.04, emotionalTone: "支援", networkNovelTip: "回收伙伴线，避免主角全程单刷。" },
    { index: 15, name: "过回归门槛", englishName: "Crossing the Return Threshold", purpose: "把新规则带回旧世界。", wordRatio: 0.06, emotionalTone: "整合", networkNovelTip: "让主角用新能力处理老问题。" },
    { index: 16, name: "两个世界的大师", englishName: "Master of Two Worlds", purpose: "主角同时掌握旧世界和新世界的运行方式。", wordRatio: 0.06, emotionalTone: "稳定", networkNovelTip: "可对应阶段性封神、成为宗门核心、建立势力。" },
    { index: 17, name: "自由自在", englishName: "Freedom to Live", purpose: "完成阶段命题，进入下一轮更大循环。", wordRatio: 0.05, emotionalTone: "释然", networkNovelTip: "网文不必完结，可用作卷末收束和新卷引子。" },
  ],
};
