import type { Preset } from "../types.js";

export const dialogueColloquialAntiAiPreset: Preset = {
  id: "anti-ai-dialogue-colloquial",
  name: "口语化对话",
  category: "anti-ai",
  description: "降低对话书面腔，让台词符合角色身份、年龄和处境。",
  promptInjection: "对话必须像角色当场说出来的话：允许省略、打断、半句话、称呼变化和语气词；不同身份角色要有用词差异，禁止所有人都说旁白式完整句。",
  tags: ["AI味", "对话"],
  postWriteChecks: [
    {
      checkId: "dialogue-colloquial",
      name: "对话书面腔检查",
      description: "检查台词是否过度完整、解释性过强。",
      checkType: "dialogue-colloquial",
      threshold: 0.35,
      suggestion: "减少解释性台词，加入省略、打断和角色专属用词。",
    },
  ],
};
