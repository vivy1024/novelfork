/**
 * Runtime plugin host — per-process registry for portable plugin contributions.
 *
 * One host instance owns the contributions loaded in this process. A host
 * resolves what a given narrator session sees by intersecting enabled plugin
 * ids and the current project type, then flattening the contributions into
 * one view (tools / routes / pages / prompt extensions / learning docs).
 * Register/unregister are fatal no-ops on conflict — partial Registration is
 * rejected so a bad plugin never leaves a half-applied state behind.
 */

import type {
  ResolvedRuntimeContributions,
  RuntimeAgentPresetContribution,
  RuntimeLearningContribution,
  RuntimePageContribution,
  RuntimePluginContribution,
  RuntimePromptExtension,
  RuntimeResolveContext,
  RuntimeRouteContribution,
  RuntimeToolContribution,
} from "./runtime-contract.js";

type InternalEntry = {
  readonly contribution: RuntimePluginContribution;
};

function contributeProjectTypes(contribution: RuntimePluginContribution): readonly string[] {
  return contribution.projectTypes ?? [];
}

function conflictLabel(kind: string, value: string): string {
  return `${kind} conflict: ${value}`;
}

export class RuntimePluginHost {
  private readonly entries = new Map<string, InternalEntry>();

  register(contribution: RuntimePluginContribution): void {
    const id = contribution.id.trim();
    if (!id) throw new Error("plugin id must be non-empty");
    if (this.entries.has(id)) {
      throw new Error(conflictLabel("plugin id", id));
    }

    // Collect names upfront so we can detect conflicts atomically.
    const toolNames = new Set<string>();
    const routeKeys = new Set<string>();
    const routeIds = new Set<string>();
    const pageIds = new Set<string>();
    const pagePaths = new Set<string>();
    const presetIds = new Set<string>();
    const promptIds = new Set<string>();
    const learningCategories = new Set<string>();
    const learningDocs = new Set<string>();

    for (const existing of this.entries.values()) {
      for (const tool of existing.contribution.tools ?? []) toolNames.add(tool.definition.name);
      for (const route of existing.contribution.routes ?? []) {
        routeIds.add(route.id);
        routeKeys.add(`${route.method} ${route.path}`);
      }
      for (const page of existing.contribution.pages ?? []) {
        pageIds.add(page.id);
        pagePaths.add(page.path);
      }
      for (const preset of existing.contribution.agentPresets ?? []) presetIds.add(preset.id);
      for (const prompt of existing.contribution.promptExtensions ?? []) promptIds.add(prompt.id);
      for (const category of existing.contribution.learning?.categories ?? []) learningCategories.add(category.id);
      for (const doc of existing.contribution.learning?.docs ?? []) learningDocs.add(doc.id);
    }

    for (const tool of contribution.tools ?? []) {
      if (toolNames.has(tool.definition.name)) {
        throw new Error(conflictLabel("tool name", tool.definition.name));
      }
      toolNames.add(tool.definition.name);
    }
    for (const route of contribution.routes ?? []) {
      if (routeIds.has(route.id) || routeKeys.has(`${route.method} ${route.path}`)) {
        throw new Error(conflictLabel("route", route.id));
      }
      routeIds.add(route.id);
      routeKeys.add(`${route.method} ${route.path}`);
    }
    for (const page of contribution.pages ?? []) {
      if (pageIds.has(page.id) || pagePaths.has(page.path)) {
        throw new Error(conflictLabel("page", page.id));
      }
      pageIds.add(page.id);
      pagePaths.add(page.path);
    }
    for (const preset of contribution.agentPresets ?? []) {
      if (presetIds.has(preset.id)) throw new Error(conflictLabel("preset", preset.id));
      presetIds.add(preset.id);
    }
    for (const prompt of contribution.promptExtensions ?? []) {
      if (promptIds.has(prompt.id)) throw new Error(conflictLabel("prompt id", prompt.id));
      promptIds.add(prompt.id);
    }
    for (const category of contribution.learning?.categories ?? []) {
      if (learningCategories.has(category.id)) {
        throw new Error(conflictLabel("learning category id", category.id));
      }
      learningCategories.add(category.id);
    }
    for (const doc of contribution.learning?.docs ?? []) {
      if (learningDocs.has(doc.id)) throw new Error(conflictLabel("learning doc id", doc.id));
      learningDocs.add(doc.id);
    }

    this.entries.set(id, { contribution });
  }

  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  resolve(context: RuntimeResolveContext): ResolvedRuntimeContributions {
    const tools: RuntimeToolContribution[] = [];
    const routes: RuntimeRouteContribution[] = [];
    const pages: RuntimePageContribution[] = [];
    const presets: RuntimeAgentPresetContribution[] = [];
    const prompts: RuntimePromptExtension[] = [];
    const learning: RuntimeLearningContribution[] = [];

    for (const entry of this.entries.values()) {
      const { contribution } = entry;
      // Only plugins explicitly enabled for this session contribute.
      if (!context.enabledPluginIds.includes(contribution.id)) continue;
      const projectTypes = contributeProjectTypes(contribution);
      if (projectTypes.length > 0 && !projectTypes.includes(context.projectType)) continue;

      tools.push(...(contribution.tools ?? []));
      routes.push(...(contribution.routes ?? []));
      pages.push(...(contribution.pages ?? []));
      presets.push(...(contribution.agentPresets ?? []));
      prompts.push(...(contribution.promptExtensions ?? []));
      if (contribution.learning) learning.push(contribution.learning);
    }

    // Prompt extensions: sort by position (before < none < after), then order, then id.
    const positionWeight = (value: RuntimePromptExtension["position"]): number =>
      value === "before" ? 0 : value === "after" ? 2 : 1;
    const sortedPrompts = [...prompts].sort((left, right) => {
      const byPosition = positionWeight(left.position) - positionWeight(right.position);
      if (byPosition !== 0) return byPosition;
      const byOrder = (left.order ?? 0) - (right.order ?? 0);
      if (byOrder !== 0) return byOrder;
      return left.id.localeCompare(right.id);
    });

    return {
      tools,
      routes,
      pages,
      agentPresets: presets,
      promptExtensions: sortedPrompts,
      learning,
    };
  }
}
