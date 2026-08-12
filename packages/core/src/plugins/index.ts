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
  PluginUISection,
} from "./types.js";
export type { PluginManagerConfig } from "./plugin-manager.js";
export type { CorePluginActivationSnapshot, PluginManagerLifecycleListener } from "./plugin-lifecycle.js";
export { RuntimePluginHost } from "./runtime-plugin-host.js";
export type {
  PortableJsonPrimitive,
  PortableJsonValue,
  PortableJsonSchema,
  RuntimeResourceBinding,
  RuntimeTextGenerationMessage,
  RuntimeTextGenerationRequest,
  RuntimeTextGenerationResult,
  RuntimeTextGenerator,
  RuntimeResolveContext,
  RuntimeLoadedSkill,
  ToolExecutionContext,
  RuntimeToolRisk,
  RuntimeToolDefinition,
  RuntimeToolResult,
  RuntimeToolHandler,
  RuntimeToolContribution,
  RuntimeRouteContribution,
  RuntimePageContribution,
  RuntimeAgentPresetContribution,
  RuntimePromptExtension,
  RuntimeLearningLocalizedText,
  RuntimeLearningCategoryContribution,
  RuntimeLearningActionContribution,
  RuntimeLearningDocumentContribution,
  RuntimeLearningContribution,
  RuntimePluginContribution,
  ResolvedRuntimeContributions,
} from "./runtime-contract.js";
