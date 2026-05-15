import type { BeatTemplate } from "../types.js";

export const saveTheCatTemplate: BeatTemplate = {
  id: "save-the-cat",
  name: "救猫咪 15 节拍",
  description: "基于 Blake Snyder 的 15 节拍结构，适合把长篇卷纲拆成可执行的戏剧节点。",
  beats: [
    { index: 1, name: "开场画面", englishName: "Opening Image", purpose: "展示主角当前状态和世界基调。", wordRatio: 0.02, emotionalTone: "定调", networkNovelTip: "第一章必须给出人物处境和题材承诺。" },
    { index: 2, name: "主题陈述", englishName: "Theme Stated", purpose: "暗示本书或本卷的核心命题。", wordRatio: 0.03, emotionalTone: "提示", networkNovelTip: "可以由配角一句话点出，但不要说教。" },
    { index: 3, name: "铺设", englishName: "Set-Up", purpose: "建立主角、目标、缺陷、关系和世界规则。", wordRatio: 0.08, emotionalTone: "铺陈", networkNovelTip: "黄金三章内完成主角、金手指、核心钩子。" },
    { index: 4, name: "催化事件", englishName: "Catalyst", purpose: "让主角无法继续原生活。", wordRatio: 0.04, emotionalTone: "冲击", networkNovelTip: "退婚、追杀、任务、事故、榜单变动都可。" },
    { index: 5, name: "辩论", englishName: "Debate", purpose: "主角权衡是否进入新局面。", wordRatio: 0.07, emotionalTone: "犹豫", networkNovelTip: "给主角一个不立刻行动的现实理由。" },
    { index: 6, name: "进入第二幕", englishName: "Break into Two", purpose: "主角主动越过门槛。", wordRatio: 0.04, emotionalTone: "决断", networkNovelTip: "从被动挨打变主动选择。" },
    { index: 7, name: "B 故事", englishName: "B Story", purpose: "建立情感线、伙伴线或价值线。", wordRatio: 0.05, emotionalTone: "连接", networkNovelTip: "用关系线缓解纯升级疲劳。" },
    { index: 8, name: "游戏时间", englishName: "Fun and Games", purpose: "兑现题材乐趣和主要卖点。", wordRatio: 0.15, emotionalTone: "爽感", networkNovelTip: "修炼、打脸、副本、推理、恋爱拉扯集中兑现。" },
    { index: 9, name: "中点", englishName: "Midpoint", purpose: "镜像时刻，虚假胜利或虚假失败。", wordRatio: 0.08, emotionalTone: "反转", networkNovelTip: "中点必须改变目标尺度，不只是打赢一场。" },
    { index: 10, name: "坏人逼近", englishName: "Bad Guys Close In", purpose: "外部敌人和内部缺陷同时施压。", wordRatio: 0.1, emotionalTone: "压迫", networkNovelTip: "不要只加敌人战力，也要加代价和误会。" },
    { index: 11, name: "一无所有", englishName: "All Is Lost", purpose: "让主角失去关键支撑。", wordRatio: 0.06, emotionalTone: "跌落", networkNovelTip: "可用伙伴离散、身份败露、金手指失灵。" },
    { index: 12, name: "灵魂黑夜", englishName: "Dark Night of the Soul", purpose: "主角面对内在问题。", wordRatio: 0.06, emotionalTone: "低谷", networkNovelTip: "这是人物升华关键，不要跳过。" },
    { index: 13, name: "进入第三幕", englishName: "Break into Three", purpose: "A/B 故事合流，找到新解法。", wordRatio: 0.04, emotionalTone: "觉醒", networkNovelTip: "让情感线或伙伴线提供破局答案。" },
    { index: 14, name: "终局", englishName: "Finale", purpose: "执行新方案，解决本卷主要矛盾。", wordRatio: 0.15, emotionalTone: "高潮", networkNovelTip: "分层递进：小胜、反扑、终胜、代价。" },
    { index: 15, name: "终场画面", englishName: "Final Image", purpose: "展示变化后的主角和新世界。", wordRatio: 0.03, emotionalTone: "收束", networkNovelTip: "卷末给满足感，也埋下一卷钩子。" },
  ],
};
