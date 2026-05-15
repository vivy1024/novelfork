import type { Preset } from "../types.js";

export const characterMultidimLiteraryPreset: Preset = {
  id: "literary-character-multidim",
  name: "人物多维度展开",
  category: "literary",
  description: "要求重要角色具备身份标签、反差细节和独立动机。",
  promptInjection: "每个重要角色至少具备两个身份标签、一个反差细节和一个独立动机；不要只用外貌或立场定义人物。",
  tags: ["人物", "群像"],
};
