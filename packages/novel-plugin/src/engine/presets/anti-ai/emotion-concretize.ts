import type { Preset } from "../types.js";

export const emotionConcretizeAntiAiPreset: Preset = {
  id: "anti-ai-emotion-concretize",
  name: "情感具体化",
  category: "anti-ai",
  description: "用动作、身体反应和五感替代抽象情绪标签。",
  promptInjection: "不要直接写“他很愤怒/悲伤/震惊”；改写为手部动作、呼吸、视线、停顿、物件变化和环境感受，让读者自行判断情绪。",
  tags: ["AI味", "情绪"],
  postWriteChecks: [
    {
      checkId: "emotion-concretize",
      name: "抽象情绪检查",
      description: "检查是否过度使用抽象情绪词。",
      checkType: "emotion-concretize",
      threshold: 5,
      suggestion: "把抽象情绪改成动作、五感或对话停顿。",
    },
  ],
};
