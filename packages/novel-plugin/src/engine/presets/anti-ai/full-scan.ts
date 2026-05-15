import type { Preset } from "../types.js";

export const fullScanAntiAiPreset: Preset = {
  id: "anti-ai-full-scan",
  name: "12 特征全量扫描",
  category: "anti-ai",
  description: "写作前提醒避开常见 AI 味，写后建议接入完整 AI 味检测。",
  promptInjection: "写作时主动避开分析报告腔、连续同构句、抽象情绪、模板化转折、泛泛总结、全场震惊、空洞形容词、过密连接词、无效排比、机械反问、过度解释和结尾说教。",
  tags: ["AI味", "全量扫描"],
  postWriteChecks: [
    {
      checkId: "anti-ai-full-scan",
      name: "AI 味全量扫描",
      description: "建议复用 ai-taste-filter 的 12 特征检测结果。",
      checkType: "custom",
      threshold: 35,
      suggestion: "若 AI 味分数偏高，优先修正同构句、抽象情绪和报告腔。",
    },
  ],
};
