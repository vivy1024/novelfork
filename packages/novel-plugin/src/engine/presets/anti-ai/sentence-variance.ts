import type { Preset } from "../types.js";

export const sentenceVarianceAntiAiPreset: Preset = {
  id: "anti-ai-sentence-variance",
  name: "句长方差修复",
  category: "anti-ai",
  description: "打破 AI 常见的句长均质和段落节奏机械感。",
  promptInjection: "同一自然段内混合短句、中句和长句；关键动作可用 5-12 字短句落点，解释或压迫感可用 40-80 字长句，但不得连续三句长度相近。",
  tags: ["AI味", "节奏"],
  postWriteChecks: [
    {
      checkId: "sentence-variance",
      name: "句长方差检查",
      description: "检查句长标准差是否过低。",
      checkType: "sentence-variance",
      threshold: 12,
      suggestion: "增加短促动作句和较长观察句，打破连续同构。",
    },
  ],
};
