import type { PluginManifest } from "@vivy1024/novelfork-core";

export const NOVEL_PLUGIN_MANIFEST: PluginManifest = {
  name: "novelfork-novel",
  displayName: "NovelFork 小说写作插件",
  version: "0.2.0",
  description: "小说写作核心插件，提供章节管理、经纬、驾驶舱、PGI、引导式生成等工具",
  projectType: "novel",
  tools: [],       // Phase 3 迁移时填充
  agentPresets: [], // Phase 3 迁移时填充
  routes: [],      // Phase 3 迁移时填充
  systemPromptExtensions: [],
};

export default NOVEL_PLUGIN_MANIFEST;
