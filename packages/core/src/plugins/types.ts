/**
 * Plugin System Types
 *
 * Inspired by AstrBot Star system and Rivet Plugin architecture.
 * Provides a lightweight plugin system for extending InkOS functionality.
 */

import type { ToolDefinition, ToolHandler, GenericToolHandler } from "../registry/tool-registry.js";
import type { PipelineStage, HookHandler } from "../hooks/types.js";

/**
 * Plugin manifest - describes plugin metadata and capabilities
 */
export interface PluginManifest {
  /** Plugin unique identifier (kebab-case) */
  readonly name: string;
  /** Display name */
  readonly displayName: string;
  /** Plugin version (semver) */
  readonly version: string;
  /** Plugin description */
  readonly description: string;
  /** Plugin author */
  readonly author?: string;
  /** Plugin homepage or repository URL */
  readonly homepage?: string;
  /** Tools provided by this plugin */
  readonly tools?: ReadonlyArray<string>;
  /** Hooks provided by this plugin */
  readonly hooks?: ReadonlyArray<PipelineStage>;
  /** Plugin configuration schema */
  readonly configSchema?: Record<string, unknown>;
}

/**
 * Plugin lifecycle state
 */
export type PluginState =
  | "discovered"   // Found but not loaded
  | "loaded"       // Module loaded
  | "initialized"  // Plugin initialized
  | "active"       // Plugin running
  | "error"        // Plugin failed
  | "terminated";  // Plugin stopped

/**
 * Plugin tool registration
 */
export interface PluginTool {
  /** Tool definition */
  readonly definition: ToolDefinition;
  /** Tool handler */
  readonly handler: ToolHandler | GenericToolHandler;
}

/**
 * Plugin hook registration
 */
export interface PluginHook {
  /** Pipeline stage to hook into */
  readonly stage: PipelineStage;
  /** Hook handler */
  readonly handler: HookHandler;
}

/**
 * Plugin context - provided to plugins during initialization
 */
export interface PluginContext {
  /** Plugin configuration from user */
  readonly config: Record<string, unknown>;
  /** Logger instance */
  readonly logger: {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  /** Plugin data directory path */
  readonly dataDir: string;
}

/**
 * Plugin metadata - runtime information
 */
export interface PluginMetadata {
  /** Plugin manifest */
  readonly manifest: PluginManifest;
  /** Current state */
  state: PluginState;
  /** Plugin directory path */
  readonly path: string;
  /** Error message if state is "error" */
  error?: string;
  /** Registered tools count */
  toolsCount: number;
  /** Registered hooks count */
  hooksCount: number;
  /** Plugin enabled/disabled */
  enabled: boolean;
}
