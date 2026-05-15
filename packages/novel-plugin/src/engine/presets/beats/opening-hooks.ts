import type { BeatTemplate } from "../types.js";

export const openingHooksTemplate: BeatTemplate = {
  id: "opening-hooks",
  name: "网文开篇钩子 12 式",
  description: "面向黄金三章的开篇吸引力模板，帮助新人快速建立主角、冲突、金手指和期待感。",
  beats: [
    { index: 1, name: "身份落差", purpose: "用主角当前低位与潜在高位制造反差。", wordRatio: 0.08, emotionalTone: "压抑", networkNovelTip: "废柴、落榜、破产、退婚、失业都属于此类。" },
    { index: 2, name: "强冲突开场", purpose: "第一场就让人物利益发生碰撞。", wordRatio: 0.08, emotionalTone: "紧张", networkNovelTip: "不要先讲百科设定，先让人吵起来/打起来/输掉。" },
    { index: 3, name: "金手指异常", purpose: "展示不寻常能力，但保留限制。", wordRatio: 0.08, emotionalTone: "惊异", networkNovelTip: "读者要立刻知道这本书和别书不一样。" },
    { index: 4, name: "悬疑问题", purpose: "提出一个非看不可的问题。", wordRatio: 0.08, emotionalTone: "好奇", networkNovelTip: "问题要具体：谁杀了他？为什么只有我记得？" },
    { index: 5, name: "世界异常", purpose: "让日常中出现不合理裂缝。", wordRatio: 0.08, emotionalTone: "诡异", networkNovelTip: "适合克苏鲁、灵异、科幻和反套路。" },
    { index: 6, name: "制度压迫", purpose: "用规则、债务、考试、审核制造压力。", wordRatio: 0.08, emotionalTone: "荒诞", networkNovelTip: "适合黑色幽默和现实映射。" },
    { index: 7, name: "死亡倒计时", purpose: "给主角明确时间压力。", wordRatio: 0.08, emotionalTone: "急迫", networkNovelTip: "倒计时比泛泛危机更容易促成追读。" },
    { index: 8, name: "名场面预告", purpose: "先给一帧未来高潮，再回到起点。", wordRatio: 0.08, emotionalTone: "期待", networkNovelTip: "倒叙/插叙要短，不能剧透全部答案。" },
    { index: 9, name: "关系破裂", purpose: "用背叛、误会、退婚、断亲触发行动。", wordRatio: 0.08, emotionalTone: "刺痛", networkNovelTip: "情绪要具体，不能只写“他很愤怒”。" },
    { index: 10, name: "选择困境", purpose: "让主角第一章就做艰难选择。", wordRatio: 0.08, emotionalTone: "抉择", networkNovelTip: "选择的两个方向都要有代价。" },
    { index: 11, name: "爽点预付", purpose: "在开篇给一个小满足感。", wordRatio: 0.08, emotionalTone: "释放", networkNovelTip: "小打脸、小破局、小反转即可，不要提前透支。" },
    { index: 12, name: "哲学命题", purpose: "用一句场景内的话锚定全书价值观。", wordRatio: 0.12, emotionalTone: "定调", networkNovelTip: "命题要藏在人物处境里，不要写成口号。" },
  ],
};
