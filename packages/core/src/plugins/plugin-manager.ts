/**
 * PluginManager - Manages plugin lifecycle and registration
 *
 * Responsibilities:
 * - Discover plugins from plugins/ directory
 * - Load plugin modules dynamically
 * - Initialize and activate plugins
 * - Register plugin tools and hooks
 * - Handle plugin configuration
 * - Support hot reload (file watching)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { NovelForkPlugin } from "./plugin-base.js";
import type {
  PluginManifest,
  PluginMetadata,
  PluginState,
  PluginContext,
} from "./types.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import type { HookManager } from "../hooks/hook-manager.js";
import type { Logger } from "../utils/logger.js";
import type { CorePluginActivationSnapshot, PluginManagerLifecycleListener } from "./plugin-lifecycle.js";

/**
 * Plugin manager configuration
 */
export interface PluginManagerConfig {
  /** Plugins directory path */
  pluginsDir: string;
  /** Plugin data directory path */
  dataDir: string;
  /** Tool registry instance */
  toolRegistry: ToolRegistry;
  /** Hook manager instance */
  hookManager: HookManager;
  /** Logger instance */
  logger: Logger;
  /** Enable hot reload */
  hotReload?: boolean;
  /** Neutral projection callbacks for embedding runtimes such as Studio. */
  lifecycleListener?: PluginManagerLifecycleListener;
}

/**
 * PluginManager class
 */
export class PluginManager {
  private plugins = new Map<string, PluginMetadata>();
  private instances = new Map<string, NovelForkPlugin>();
  private config: PluginManagerConfig;
  private userConfigs = new Map<string, Record<string, unknown>>();
  private registeredTools = new Map<string, ReturnType<NovelForkPlugin["getTools"]>>();
  private registeredHooks = new Map<string, ReturnType<NovelForkPlugin["getHooks"]>>();

  constructor(config: PluginManagerConfig) {
    this.config = config;
  }

  /**
   * Discover all plugins in plugins directory
   */
  async discover(): Promise<void> {
    this.config.logger.info(`Discovering plugins in: ${this.config.pluginsDir}`);

    try {
      const entries = await readdir(this.config.pluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = join(this.config.pluginsDir, entry.name);
        const manifestPath = join(pluginPath, "manifest.json");

        try {
          // Read manifest
          const manifestContent = await readFile(manifestPath, "utf-8");
          const manifest: PluginManifest = JSON.parse(manifestContent);

          // Validate manifest
          if (!manifest.name || !manifest.version) {
            this.config.logger.warn(`Invalid manifest in ${entry.name}: missing name or version`);
            continue;
          }

          // Check if index file exists
          const indexPath = join(pluginPath, "index.ts");
          const indexJsPath = join(pluginPath, "index.js");
          let hasIndex = false;

          try {
            await stat(indexPath);
            hasIndex = true;
          } catch {
            try {
              await stat(indexJsPath);
              hasIndex = true;
            } catch {
              // No index file
            }
          }

          if (!hasIndex) {
            this.config.logger.warn(`Plugin ${manifest.name} has no index.ts or index.js`);
            continue;
          }

          // Register plugin metadata
          this.plugins.set(manifest.name, {
            manifest,
            state: "discovered",
            path: pluginPath,
            toolsCount: 0,
            hooksCount: 0,
            enabled: true, // Default enabled
          });

          this.config.logger.info(`Discovered plugin: ${manifest.name} v${manifest.version}`);
        } catch (e) {
          this.config.logger.error(`Failed to discover plugin ${entry.name}: ${e}`);
        }
      }
    } catch (e) {
      this.config.logger.error(`Failed to read plugins directory: ${e}`);
    }
  }

  /**
   * Load a specific plugin module
   */
  async load(pluginName: string): Promise<void> {
    const metadata = this.plugins.get(pluginName);
    if (!metadata) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (metadata.state !== "discovered") {
      this.config.logger.warn(`Plugin ${pluginName} already loaded`);
      return;
    }

    try {
      // Dynamic import
      const indexPath = resolve(metadata.path, "index.js");
      const module = await import(indexPath);

      // Get plugin class (default export)
      const PluginClass = module.default;
      if (!PluginClass) {
        throw new Error("Plugin must export a default class");
      }

      // Instantiate plugin
      const instance: NovelForkPlugin = new PluginClass();
      this.instances.set(pluginName, instance);

      metadata.state = "loaded";
      this.config.logger.info(`Loaded plugin: ${pluginName}`);
    } catch (e) {
      metadata.state = "error";
      metadata.error = e instanceof Error ? e.message : String(e);
      this.config.logger.error(`Failed to load plugin ${pluginName}: ${e}`);
      throw e;
    }
  }

  /**
   * Initialize a loaded plugin
   */
  async initialize(pluginName: string): Promise<void> {
    const metadata = this.plugins.get(pluginName);
    const instance = this.instances.get(pluginName);

    if (!metadata || !instance) {
      throw new Error(`Plugin not loaded: ${pluginName}`);
    }

    if (metadata.state !== "loaded") {
      this.config.logger.warn(`Plugin ${pluginName} not in loaded state`);
      return;
    }

    try {
      // Create plugin context
      const ctx: PluginContext = {
        config: this.userConfigs.get(pluginName) || {},
        logger: {
          debug: (msg) => this.config.logger.debug(`[${pluginName}] ${msg}`),
          info: (msg) => this.config.logger.info(`[${pluginName}] ${msg}`),
          warn: (msg) => this.config.logger.warn(`[${pluginName}] ${msg}`),
          error: (msg) => this.config.logger.error(`[${pluginName}] ${msg}`),
        },
        dataDir: join(this.config.dataDir, pluginName),
      };

      // Initialize plugin
      await instance.initialize(ctx);

      metadata.state = "initialized";
      this.config.logger.info(`Initialized plugin: ${pluginName}`);
    } catch (e) {
      metadata.state = "error";
      metadata.error = e instanceof Error ? e.message : String(e);
      this.config.logger.error(`Failed to initialize plugin ${pluginName}: ${e}`);
      throw e;
    }
  }

  /**
   * Activate a plugin - register tools and hooks
   */
  async activate(pluginName: string): Promise<void> {
    const metadata = this.plugins.get(pluginName);
    const instance = this.instances.get(pluginName);

    if (!metadata || !instance) {
      throw new Error(`Plugin not initialized: ${pluginName}`);
    }

    if (metadata.state !== "initialized") {
      this.config.logger.warn(`Plugin ${pluginName} not in initialized state`);
      return;
    }

    let tools: ReturnType<NovelForkPlugin["getTools"]> = [];
    let hooks: ReturnType<NovelForkPlugin["getHooks"]> = [];
    let projectionStarted = false;

    try {
      // The plugin must be running before Core capabilities are collected.
      await instance.activate();

      tools = instance.getTools();
      const registeredTools: ReturnType<NovelForkPlugin["getTools"]> = [];
      this.registeredTools.set(pluginName, registeredTools);
      for (const tool of tools) {
        this.config.toolRegistry.register({
          ...tool,
          definition: {
            ...tool.definition,
            source: "plugin",
          },
        });
        registeredTools.push(tool);
      }

      hooks = instance.getHooks();
      const registeredHooks: ReturnType<NovelForkPlugin["getHooks"]> = [];
      this.registeredHooks.set(pluginName, registeredHooks);
      for (const hook of hooks) {
        this.config.hookManager.register(hook.stage, hook.handler);
        registeredHooks.push(hook);
      }

      const lifecycleListener = this.config.lifecycleListener;
      if (lifecycleListener) {
        projectionStarted = true;
        const snapshot: CorePluginActivationSnapshot = {
          pluginName,
          manifest: metadata.manifest,
          tools,
        };
        await lifecycleListener.onActivationPrepared(snapshot);
      }

      metadata.toolsCount = tools.length;
      metadata.hooksCount = hooks.length;
      metadata.error = undefined;
      metadata.state = "active";
      this.config.logger.info(
        `Activated plugin: ${pluginName} (${tools.length} tools, ${hooks.length} hooks)`,
      );
    } catch (error) {
      metadata.error = error instanceof Error ? error.message : String(error);
      const rollbackErrors: unknown[] = [];

      if (projectionStarted && this.config.lifecycleListener) {
        try {
          await this.config.lifecycleListener.onDeactivating(pluginName);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }

      this.unregisterCoreCapabilities(pluginName, rollbackErrors);
      try {
        await instance.deactivate();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }

      metadata.toolsCount = 0;
      metadata.hooksCount = 0;
      metadata.state = rollbackErrors.length === 0 ? "initialized" : "error";
      this.config.logger.error(`Failed to activate plugin ${pluginName}: ${error}`);
      throw error;
    }
  }

  private unregisterCoreCapabilities(pluginName: string, errors: unknown[]): void {
    const tools = this.registeredTools.get(pluginName) ?? [];
    for (const tool of [...tools].reverse()) {
      try {
        this.config.toolRegistry.unregister(tool.definition.name);
      } catch (error) {
        errors.push(error);
      }
    }
    this.registeredTools.delete(pluginName);

    const hooks = this.registeredHooks.get(pluginName) ?? [];
    for (const hook of [...hooks].reverse()) {
      try {
        this.config.hookManager.unregister(hook.stage, hook.handler);
      } catch (error) {
        errors.push(error);
      }
    }
    this.registeredHooks.delete(pluginName);
  }

  /**
   * Deactivate a plugin - hide projection, remove Core capabilities, then stop plugin.
   * A failed cleanup remains retryable with the host projection hidden.
   */
  async deactivate(pluginName: string): Promise<void> {
    const metadata = this.plugins.get(pluginName);
    const instance = this.instances.get(pluginName);

    if (!metadata || !instance) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (metadata.state !== "active" && metadata.state !== "deactivation-error") {
      this.config.logger.warn(`Plugin ${pluginName} not active`);
      return;
    }

    let projectionHidden = false;
    try {
      if (this.config.lifecycleListener) {
        await this.config.lifecycleListener.onDeactivating(pluginName);
      }
      projectionHidden = true;

      const cleanupErrors: unknown[] = [];
      this.unregisterCoreCapabilities(pluginName, cleanupErrors);
      if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
      }

      await instance.deactivate();
      metadata.state = "terminated";
      metadata.toolsCount = 0;
      metadata.hooksCount = 0;
      metadata.enabled = false;
      metadata.error = undefined;
      try {
        await this.config.lifecycleListener?.onDeactivated?.(pluginName);
      } catch (notificationError) {
        this.config.logger.error(`Plugin ${pluginName} terminated notification failed: ${notificationError}`);
      }
      this.config.logger.info(`Deactivated plugin: ${pluginName}`);
    } catch (error) {
      if (projectionHidden) {
        metadata.state = "deactivation-error";
        metadata.enabled = false;
      } else {
        metadata.state = "active";
      }
      metadata.error = error instanceof Error ? error.message : String(error);
      this.config.logger.error(`Failed to deactivate plugin ${pluginName}: ${error}`);
      throw error;
    }
  }

  /**
   * Load and activate all discovered plugins
   */
  async loadAll(): Promise<void> {
    const pluginNames = Array.from(this.plugins.keys());

    for (const name of pluginNames) {
      const metadata = this.plugins.get(name);
      if (!metadata?.enabled) {
        this.config.logger.info(`Skipping disabled plugin: ${name}`);
        continue;
      }

      try {
        await this.load(name);
        await this.initialize(name);
        await this.activate(name);
      } catch (e) {
        this.config.logger.error(`Failed to load plugin ${name}: ${e}`);
      }
    }
  }

  /**
   * Get all plugin metadata
   */
  listPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get specific plugin metadata
   */
  getPlugin(pluginName: string): PluginMetadata | undefined {
    return this.plugins.get(pluginName);
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginName: string): Promise<void> {
    const metadata = this.plugins.get(pluginName);
    if (!metadata) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    metadata.enabled = true;

    if (metadata.state === "discovered") {
      await this.load(pluginName);
      await this.initialize(pluginName);
      await this.activate(pluginName);
    } else if (metadata.state === "terminated") {
      await this.initialize(pluginName);
      await this.activate(pluginName);
    }
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginName: string): Promise<void> {
    const metadata = this.plugins.get(pluginName);
    if (!metadata) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (metadata.state === "active" || metadata.state === "deactivation-error") {
      await this.deactivate(pluginName);
      metadata.enabled = false;
      return;
    }

    metadata.enabled = false;
  }

  /**
   * Update plugin configuration
   */
  async updateConfig(pluginName: string, config: Record<string, unknown>): Promise<void> {
    const instance = this.instances.get(pluginName);
    if (!instance) {
      throw new Error(`Plugin not loaded: ${pluginName}`);
    }

    // Validate config
    if (!instance.validateConfig(config)) {
      throw new Error(`Invalid configuration for plugin: ${pluginName}`);
    }

    this.userConfigs.set(pluginName, config);
    await instance.onConfigChange(config);
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    this.config.logger.info("Shutting down all plugins");

    for (const [name, metadata] of this.plugins.entries()) {
      if (metadata.state === "active") {
        try {
          await this.deactivate(name);
        } catch (e) {
          this.config.logger.error(`Failed to deactivate plugin ${name}: ${e}`);
        }
      }
    }
  }
}
