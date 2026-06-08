/**
 * Novel plugin page — 写作配置统一 Section。
 *
 * 整合写作预设 / 节拍模板 / 辅助工具开关三块逻辑，供 studio 宿主通过
 * 插件 UI Section 注册表渲染。
 */
export { WritingConfigSection } from "./WritingConfigSection";

/**
 * 写作配置 Section 的 UI 元数据（前端安全，无后端依赖）。
 * studio 宿主据此把该 section 挂到套路页。与 NOVEL_PLUGIN_MANIFEST.uiSections 保持一致。
 */
export const WRITING_CONFIG_UI_SECTION = {
  id: "novel-writing-config",
  label: "写作配置",
  icon: "PenLine",
  mountPoint: "routines" as const,
  requiresBook: true,
  order: 100,
  componentKey: "novel-writing-config",
};

