/**
 * 作品基础 / 故事推进两块侧栏的页签清单，以及从外部（命令面板、写作视图一键修、对话结果卡）
 * 定位到某一页的请求形状。单独成文件，宿主与 Studio 不必为了几个常量引入整个面板。
 */

/** 故事推进侧栏的页签。 */
export const STORYLINE_SUB_TABS = [
  "outline",
  "foreshadowing",
  "conflicts",
  "storylines",
  "relationships",
  "timeline",
  "chapter-summaries",
  "memory",
] as const;
export type StorylineSubTab = (typeof STORYLINE_SUB_TABS)[number];

export const STORYLINE_SUB_TAB_LABELS: Record<StorylineSubTab, string> = {
  outline: "章节与大纲",
  foreshadowing: "伏笔",
  conflicts: "矛盾",
  storylines: "剧情线",
  relationships: "关系",
  timeline: "时间线",
  "chapter-summaries": "章摘要",
  memory: "章后事实",
};

export function isStorylineSubTab(value: unknown): value is StorylineSubTab {
  return typeof value === "string" && (STORYLINE_SUB_TABS as readonly string[]).includes(value);
}

/**
 * 随剧情变化的设定分类 → 故事推进的页签；其余分类（静态设定）返回 undefined，归作品基础。
 * 卷纲/大纲在「章节与大纲」页。
 */
export function storylineTabForCategory(category: string): StorylineSubTab | undefined {
  switch (category) {
    case "outline":
      return "outline";
    case "foreshadowing":
    case "conflicts":
    case "relationships":
    case "timeline":
    case "chapter-summaries":
      return category;
    default:
      return undefined;
  }
}

/** 作品基础侧栏的主页签。 */
export const LORE_MAIN_TABS = ["characters", "cast", "settings", "draft"] as const;
export type LoreMainTab = (typeof LORE_MAIN_TABS)[number];

/** 外部定位到侧栏某一页的请求；seq 递增才会再次生效（同一页连点两次也能切回去）。 */
export interface SidebarFocusRequest<Tab extends string> {
  readonly tab: Tab;
  readonly seq: number;
}

/**
 * 对话结果卡「去故事推进看」用的产物：kind=workbench-view，id=storyline:<页签>。
 * 只有挂在写作工作台里的叙述者面板会接这个产物（独立对话页没有侧栏可去）。
 */
export const WORKBENCH_VIEW_ARTIFACT_KIND = "workbench-view";

export function storylineViewArtifactId(tab: StorylineSubTab): string {
  return `storyline:${tab}`;
}

export function parseStorylineViewArtifact(artifact: { readonly kind?: unknown; readonly id?: unknown }): StorylineSubTab | null {
  if (artifact.kind !== WORKBENCH_VIEW_ARTIFACT_KIND || typeof artifact.id !== "string") return null;
  const match = /^storyline:(.+)$/u.exec(artifact.id);
  return match && isStorylineSubTab(match[1]) ? match[1] : null;
}
