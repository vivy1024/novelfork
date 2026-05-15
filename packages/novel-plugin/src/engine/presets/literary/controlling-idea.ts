import type { Preset } from "../types.js";

export const controllingIdeaLiteraryPreset: Preset = {
  id: "literary-controlling-idea",
  name: "控制观念锚定",
  category: "literary",
  description: "要求作者用一句哲学命题锚定主线价值，避免长篇漂移。",
  promptInjection: "每章主要冲突都应与本书控制观念发生关系：要么推进、要么反驳、要么制造代价。不要让主线价值长期缺席。",
  tags: ["主题", "主线"],
};
