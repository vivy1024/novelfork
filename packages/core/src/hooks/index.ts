/**
 * Hooks module - Pipeline lifecycle interceptors
 */

export type {
  HookContext,
  HookHandler,
  PipelineHooks,
  PipelineStage,
  HookConfig,
} from "./types.js";

export { HookManager, createNotificationHook } from "./hook-manager.js";

export {
  createNotificationHook as createBuiltinNotificationHook,
  createLoggingHook,
  createAutoBackupHook,
} from "./builtin-hooks.js";
