import type { BeatTemplate } from "../types.js";

export const threeActTemplate: BeatTemplate = {
  id: "three-act",
  name: "三幕结构",
  description: "最基础的开端-对抗-解决结构，适合快速搭建卷纲。",
  beats: [
    { index: 1, name: "第一幕：建立与触发", purpose: "建立人物、世界、目标和触发事件。", wordRatio: 0.25, emotionalTone: "铺设", networkNovelTip: "前 25% 必须让读者知道主角要什么、怕什么、为什么现在必须行动。" },
    { index: 2, name: "第二幕：对抗与升级", purpose: "通过连续阻碍、反转和选择加深矛盾。", wordRatio: 0.5, emotionalTone: "拉扯", networkNovelTip: "网文中可拆成多个小副本/小高潮，避免中段只升级不转折。" },
    { index: 3, name: "第三幕：高潮与收束", purpose: "主角用新的认知/能力解决主要矛盾并展示代价。", wordRatio: 0.25, emotionalTone: "释放", networkNovelTip: "高潮后要给满足感，同时保留下一卷钩子。" },
  ],
};
