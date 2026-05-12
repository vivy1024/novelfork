/**
 * Plugin system exports
 */

export { NovelForkPlugin } from "./plugin-base.js";
export { PluginManager } from "./plugin-manager.js";
export type {
  PluginManifest,
  PluginState,
  PluginTool,
  PluginHook,
  PluginContext,
  PluginMetadata,
  PluginToolDefinition,
  PluginAgentPreset,
  PluginRouteDefinition,
  PluginPromptExtension,
} from "./types.js";
export type { PluginManagerConfig } from "./plugin-manager.js";
