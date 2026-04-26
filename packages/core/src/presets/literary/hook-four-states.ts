import type { Preset } from "../types.js";

export const hookFourStatesLiteraryPreset: Preset = {
  id: "literary-hook-four-states",
  name: "伏笔四态追踪",
  category: "literary",
  description: "将伏笔标记为埋、暗、半明、收四种状态，降低长篇遗忘风险。",
  promptInjection: "新增伏笔时注明其状态：埋=读者未意识到，暗=读者隐约察觉，半明=读者知道问题但不知道答案，收=本章兑现。写章末钩子时避免无意义新增同类伏笔债。",
  tags: ["伏笔", "长篇连续性"],
};
