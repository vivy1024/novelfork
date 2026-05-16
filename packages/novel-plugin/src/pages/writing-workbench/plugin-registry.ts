/**
 * Writing workbench plugin page registry.
 *
 * Plugins can register panels/pages that appear in the workbench toolbar.
 * The novel plugin registers: JingweiPanel, WritingToolsPanel, CheckpointPanel, etc.
 *
 * This enables a plugin-driven architecture where the workbench doesn't need
 * to hardcode knowledge of every panel — plugins declare their UI contributions.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface WorkbenchPluginPage {
  id: string;
  label: string;
  icon?: string;
  component: ComponentType<{ bookId: string }> | LazyExoticComponent<ComponentType<{ bookId: string }>>;
  /** Only show when a book is active */
  requiresBook?: boolean;
  /** Sort order in the toolbar (lower = earlier) */
  order?: number;
}

const registry: WorkbenchPluginPage[] = [];

export function registerWorkbenchPage(page: WorkbenchPluginPage): void {
  if (!registry.find((p) => p.id === page.id)) {
    registry.push(page);
    registry.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }
}

export function getWorkbenchPages(): readonly WorkbenchPluginPage[] {
  return registry;
}

/**
 * Register all novel plugin pages.
 * Called once at app startup to inject novel-specific panels into the workbench.
 */
export function registerNovelPluginPages(): void {
  registerWorkbenchPage({
    id: "jingwei",
    label: "经纬",
    icon: "Globe",
    order: 10,
    requiresBook: true,
    component: lazy(() =>
      import("./jingwei/JingweiPanel").then((m) => ({ default: m.JingweiPanel })),
    ),
  });

  registerWorkbenchPage({
    id: "checkpoints",
    label: "快照",
    icon: "History",
    order: 30,
    requiresBook: true,
    component: lazy(() =>
      import("./CheckpointPanel").then((m) => ({ default: m.CheckpointPanel as unknown as ComponentType<{ bookId: string }> })),
    ),
  });
}
