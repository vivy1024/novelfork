/**
 * Plugin System Types
 *
 * Inspired by AstrBot Star system and Rivet Plugin architecture.
 * Provides a lightweight plugin system for extending NovelFork functionality.
 */

import type { ToolDefinition, ToolHandler, GenericToolHandler } from "../registry/tool-registry.js";
import type { PipelineStage, HookHandler } from "../hooks/types.js";

/**
 * Plugin manifest - describes plugin metadata and capabilities
 */
export interface PluginManifest {
  /** Plugin unique identifier (kebab-case). Falls back to `name` if not provided. */
  readonly id?: string;
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
  /** Target project type (e.g. "novel", "general") — used for scope filtering */
  readonly projectType?: string;
  /** Tools provided by this plugin (legacy: string names, or full PluginToolDefinition) */
  readonly tools?: ReadonlyArray<string> | ReadonlyArray<PluginToolDefinition>;
  /** Hooks provided by this plugin */
  readonly hooks?: ReadonlyArray<PipelineStage>;
  /** Agent presets provided by this plugin */
  readonly agentPresets?: ReadonlyArray<PluginAgentPreset>;
  /** HTTP routes provided by this plugin */
  readonly routes?: ReadonlyArray<PluginRouteDefinition>;
  /** System prompt extensions provided by this plugin */
  readonly systemPromptExtensions?: ReadonlyArray<PluginPromptExtension>;
  /** Plugin configuration schema */
  readonly configSchema?: Record<string, unknown>;
}

/**
 * Plugin tool definition — declarative tool metadata for plugin manifest
 */
export interface PluginToolDefinition {
  /** Tool name (dot-separated namespace, e.g. "cockpit.get_snapshot") */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** JSON Schema for tool input */
  readonly inputSchema: Record<string, unknown>;
  /** Scope: "universal" tools are always available; domain-specific scopes are filtered */
  readonly scope?: "universal" | string;
  /** Risk level */
  readonly risk?: string;
  /** Permission modes where this tool is enabled */
  readonly enabledForModes?: readonly string[];
}

/**
 * Plugin agent preset — pre-configured agent role with tool set
 */
export interface PluginAgentPreset {
  /** Agent role identifier */
  readonly agentId: string;
  /** Display name */
  readonly name: string;
  /** Tools enabled for this agent */
  readonly tools: readonly string[];
  /** Additional system prompt content */
  readonly systemPromptSuffix?: string;
}

/**
 * Plugin route definition — HTTP endpoint provided by the plugin
 */
export interface PluginRouteDefinition {
  /** Route path (e.g. "/api/novel/cockpit") */
  readonly path: string;
  /** HTTP method */
  readonly method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Route description */
  readonly description?: string;
}

/**
 * Plugin system prompt extension — injected into agent prompts
 */
export interface PluginPromptExtension {
  /** Where to inject relative to the base prompt */
  readonly position: "before" | "after";
  /** Prompt content to inject */
  readonly content: string;
  /** Conditions for when this extension applies */
  readonly condition?: {
    readonly projectType?: string;
    readonly agentId?: string;
  };
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
