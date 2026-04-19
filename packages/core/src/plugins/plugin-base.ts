/**
 * NovelForkPlugin - Base class for all NovelFork plugins
 *
 * Plugins extend this class to provide custom tools and hooks.
 */

import type {
  PluginManifest,
  PluginContext,
  PluginTool,
  PluginHook,
} from "./types.js";

/**
 * Abstract base class for NovelFork plugins
 */
export abstract class NovelForkPlugin {
  protected ctx!: PluginContext;

  /**
   * Plugin manifest - must be implemented by subclasses
   */
  abstract getManifest(): PluginManifest;

  /**
   * Initialize plugin with context
   * Called after plugin is loaded but before activation
   */
  async initialize(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.ctx.logger.info(`Initializing plugin: ${this.getManifest().name}`);
  }

  /**
   * Activate plugin - start providing tools and hooks
   * Called when plugin is enabled
   */
  async activate(): Promise<void> {
    this.ctx.logger.info(`Activating plugin: ${this.getManifest().name}`);
  }

  /**
   * Deactivate plugin - cleanup resources
   * Called when plugin is disabled or system shuts down
   */
  async deactivate(): Promise<void> {
    this.ctx.logger.info(`Deactivating plugin: ${this.getManifest().name}`);
  }

  /**
   * Get tools provided by this plugin
   * Override to register custom tools
   */
  getTools(): PluginTool[] {
    return [];
  }

  /**
   * Get hooks provided by this plugin
   * Override to register custom hooks
   */
  getHooks(): PluginHook[] {
    return [];
  }

  /**
   * Validate plugin configuration
   * Override to implement custom validation
   */
  validateConfig(config: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * Handle configuration changes
   * Called when user updates plugin config
   */
  async onConfigChange(newConfig: Record<string, unknown>): Promise<void> {
    this.ctx.logger.info(`Config changed for plugin: ${this.getManifest().name}`);
  }
}
