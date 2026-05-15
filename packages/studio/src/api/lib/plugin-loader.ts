import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PluginRouteContext {
  storage: any;
  root: string;
}

export interface ToolHandlerContext {
  bookId?: string;
  sessionId: string;
  storage: any;
  root: string;
  llmService?: any;
}

export interface PluginRouteFactory {
  prefix: string;
  createRouter: (ctx: PluginRouteContext) => Hono;
}

export interface PluginPageDefinition {
  id: string;
  label: string;
  icon: string;
  componentPath: string;
  requiresBook?: boolean;
  order?: number;
}

export interface PluginToolHandler {
  toolName: string;
  execute: (input: unknown, context: ToolHandlerContext) => Promise<unknown>;
}

export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  projectType: string;
  routes: PluginRouteFactory[];
  tools: PluginToolHandler[];
  pages: PluginPageDefinition[];
  agentPresets: Array<{ agentId: string; name: string; tools: string[] }>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Central registry for loaded plugins.
 * Stores plugin metadata and provides lookup methods for routes, tools, pages,
 * and agent presets — optionally filtered by project type.
 */
export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();

  /** Register a plugin. Overwrites any existing plugin with the same id. */
  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.id, plugin);
    console.log(
      `[plugin-registry] registered plugin: ${plugin.name} (${plugin.id}) v${plugin.version}`,
    );
  }

  /** Retrieve a single plugin by id. */
  getPlugin(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Return all registered plugins. */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Collect route factories from all plugins. */
  getRoutes(): PluginRouteFactory[] {
    const routes: PluginRouteFactory[] = [];
    for (const plugin of this.plugins.values()) {
      routes.push(...plugin.routes);
    }
    return routes;
  }

  /**
   * Collect tool handlers, optionally filtered by project type.
   * When projectType is provided, only tools from plugins matching that type are returned.
   */
  getTools(projectType?: string): PluginToolHandler[] {
    const tools: PluginToolHandler[] = [];
    for (const plugin of this.plugins.values()) {
      if (projectType && plugin.projectType !== projectType) continue;
      tools.push(...plugin.tools);
    }
    return tools;
  }

  /**
   * Collect page definitions, optionally filtered by project type.
   */
  getPages(projectType?: string): PluginPageDefinition[] {
    const pages: PluginPageDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (projectType && plugin.projectType !== projectType) continue;
      pages.push(...plugin.pages);
    }
    return pages;
  }

  /**
   * Collect agent presets, optionally filtered by project type.
   */
  getPresets(
    projectType?: string,
  ): Array<{ agentId: string; name: string; tools: string[] }> {
    const presets: Array<{ agentId: string; name: string; tools: string[] }> =
      [];
    for (const plugin of this.plugins.values()) {
      if (projectType && plugin.projectType !== projectType) continue;
      presets.push(...plugin.agentPresets);
    }
    return presets;
  }

  /** Find a specific tool handler by tool name across all plugins. */
  getToolHandler(toolName: string): PluginToolHandler | undefined {
    for (const plugin of this.plugins.values()) {
      const handler = plugin.tools.find((t) => t.toolName === toolName);
      if (handler) return handler;
    }
    return undefined;
  }

  /** Check whether a plugin with the given id is registered. */
  hasPlugin(id: string): boolean {
    return this.plugins.has(id);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Singleton registry instance used at runtime. */
export const pluginRegistry = new PluginRegistry();

/** Factory for creating isolated registries (useful in tests). */
export function createPluginRegistry(): PluginRegistry {
  return new PluginRegistry();
}
