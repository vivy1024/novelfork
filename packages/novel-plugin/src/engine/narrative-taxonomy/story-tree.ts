/**
 * 故事树数据层（纯函数）。
 *
 * 一份数据，三处共用：工作台「故事推进 › 树状图」、对话里 lore.read 结果卡、
 * memory.graph 结果卡。组件不关心数据来自全量读取还是工具返回的子集。
 *
 * 层级来源（关键设计）：`book → Big-4 维度 → NarraBench 特征 → 分类 → 条目`。
 * 不依赖 `story_jingwei_entry.parent_id`（实测 209 条全空），因此不需要作者维护层级。
 *
 * 布局算法：Reingold-Tilford / Buchheim et al. 2002 的线性时间 tidy tree
 * （d3.tree 用的同一套）。选它而不是力导向，因为这里是**严格层级**；
 * 关系网是另一张图（网状，用力导向），二者分开——Barlow & Neville 2001 与
 * Stasko 2000 的实证显示：看拓扑用 node-link 树、看量值用 treemap，
 * 硬把树和网合成一张（Elastic Hierarchies）实证收益弱。
 */

import {
  CATEGORY_MAPPINGS,
  featuresOfDimension,
  mappingForCategory,
  NARRA_DIMENSIONS,
  type NarraDimension,
  type NarraFeature,
} from "./narrabench";

// ─── 输入 ─────────────────────────────────────────────────────────────────

export interface TreeEntryInput {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly summaryMd?: string | null;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
  readonly lifecycle?: string;
  readonly status?: string;
}

/** 关系边：来自 narrative_relation（外键）或经纬 relationships 条目的 source/target。 */
export interface TreeRelationInput {
  readonly id?: string;
  readonly sourceName?: string;
  readonly targetName?: string;
  readonly predicate?: string;
  readonly kind?: string;
  readonly validFrom?: number;
  readonly validTo?: number;
}

export interface BuildStoryTreeInput {
  readonly entries?: readonly TreeEntryInput[];
  readonly relations?: readonly TreeRelationInput[];
  /** 只保留这些维度（工具卡里按需裁剪）。 */
  readonly dimensions?: readonly NarraDimension[];
  /** 每个分类下最多展开多少条目，其余折叠计数。默认 40。 */
  readonly maxEntriesPerCategory?: number;
}

// ─── 输出 ─────────────────────────────────────────────────────────────────

export type TreeNodeKind = "root" | "dimension" | "feature" | "category" | "entry";

export interface StoryTreeNode {
  readonly id: string;
  readonly kind: TreeNodeKind;
  readonly label: string;
  /** 折叠时显示的计数（该子树下的条目总数）。 */
  readonly count: number;
  readonly depth: number;
  readonly children: readonly StoryTreeNode[];
  /** entry 节点专有：可跳经纬条目。 */
  readonly entryId?: string;
  readonly subtitle?: string;
  readonly detail?: string;
  readonly status?: string;
  /** 该节点参与的关系边数（度数），用于半径与 LOD 排序。 */
  readonly degree?: number;
  /** 网文特有类目标记，UI 上区别于学术分类。 */
  readonly webNovelSpecific?: boolean;
  /** 默认是否展开：深层默认折叠（SpaceTree/DOI Tree 的实证：渐进展开优于全渲染）。 */
  readonly defaultExpanded: boolean;
}

export interface StoryTree {
  readonly root: StoryTreeNode;
  readonly totalEntries: number;
  /** 未登记分类的条目数（自定义类目），归入「其他」。 */
  readonly uncategorized: number;
  /** 完全没有条目的 NarraBench 特征，即真实缺口，UI 上诚实显示。 */
  readonly emptyFeatures: readonly { feature: NarraFeature; label: string; dimension: NarraDimension }[];
}

const DEFAULT_MAX_ENTRIES = 40;

// ─── 工具 ─────────────────────────────────────────────────────────────────

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** 标题裁剪：实测有把整段正文当标题的条目，树里必须截断（全文走 hover/详情）。 */
export function trimLabel(value: string | undefined, maxLength = 26): string {
  const normalized = clean(value);
  if (!normalized) return "未命名";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function entryDetail(entry: TreeEntryInput): string | undefined {
  const text = clean(entry.summaryMd ?? "") || clean(entry.contentMd ?? "");
  return text ? text.slice(0, 240) : undefined;
}

/** 条目副标题：优先展示能一眼识别的字段。 */
function entrySubtitle(entry: TreeEntryInput): string | undefined {
  const fields = entry.fields ?? {};
  for (const key of ["roleType", "type", "locationType", "realm", "status", "relationType"]) {
    const value = clean(fields[key]);
    if (value) return value;
  }
  return undefined;
}

/**
 * 关系度数：按实体名统计。
 * 这里仍用名字是因为经纬 relationships 条目只有 source/target 名字
 * （`narrative_relation` 建好并回填后应改用 entity_id；见 migration 0032 的说明）。
 */
export function buildDegreeIndex(relations: readonly TreeRelationInput[]): Map<string, number> {
  const degree = new Map<string, number>();
  const bump = (name: string) => {
    const key = clean(name);
    if (!key) return;
    degree.set(key, (degree.get(key) ?? 0) + 1);
  };
  for (const relation of relations) {
    bump(relation.sourceName ?? "");
    bump(relation.targetName ?? "");
  }
  return degree;
}

// ─── 构建 ─────────────────────────────────────────────────────────────────

export function buildStoryTree(input: BuildStoryTreeInput): StoryTree {
  const entries = input.entries ?? [];
  const relations = input.relations ?? [];
  const maxEntries = input.maxEntriesPerCategory ?? DEFAULT_MAX_ENTRIES;
  const allowedDimensions = input.dimensions ? new Set(input.dimensions) : null;
  const degreeIndex = buildDegreeIndex(relations);

  // 条目按分类分组；未登记分类单独收集
  const byCategory = new Map<string, TreeEntryInput[]>();
  const unknownCategory: TreeEntryInput[] = [];
  for (const entry of entries) {
    const category = clean(entry.category);
    if (!category) {
      unknownCategory.push(entry);
      continue;
    }
    if (!mappingForCategory(category)) {
      unknownCategory.push(entry);
      continue;
    }
    const bucket = byCategory.get(category) ?? [];
    bucket.push(entry);
    byCategory.set(category, bucket);
  }

  const emptyFeatures: { feature: NarraFeature; label: string; dimension: NarraDimension }[] = [];
  const dimensionNodes: StoryTreeNode[] = [];
  let totalEntries = 0;

  for (const dimension of NARRA_DIMENSIONS) {
    if (allowedDimensions && !allowedDimensions.has(dimension.id)) continue;

    const featureNodes: StoryTreeNode[] = [];
    let dimensionCount = 0;

    for (const feature of featuresOfDimension(dimension.id)) {
      const categoryNodes: StoryTreeNode[] = [];
      let featureCount = 0;

      for (const mapping of CATEGORY_MAPPINGS.filter((candidate) => candidate.feature === feature.id)) {
        const bucket = byCategory.get(mapping.category) ?? [];
        if (bucket.length === 0) continue;

        // 度数高的条目排前面：它们是关系网的枢纽，也是 LOD 优先显示的对象
        const sorted = [...bucket].sort((left, right) => {
          const leftName = clean(left.fields?.name) || clean(left.title);
          const rightName = clean(right.fields?.name) || clean(right.title);
          return (degreeIndex.get(rightName) ?? 0) - (degreeIndex.get(leftName) ?? 0)
            || leftName.localeCompare(rightName, "zh");
        });
        const visible = sorted.slice(0, maxEntries);

        const entryNodes: StoryTreeNode[] = visible.map((entry) => {
          const name = clean(entry.fields?.name) || clean(entry.title);
          return {
            id: `entry:${entry.id}`,
            kind: "entry" as const,
            label: trimLabel(name || entry.title, 24),
            count: 1,
            depth: 4,
            children: [],
            entryId: entry.id,
            ...(entrySubtitle(entry) ? { subtitle: entrySubtitle(entry) } : {}),
            ...(entryDetail(entry) ? { detail: entryDetail(entry) } : {}),
            ...(entry.status ? { status: entry.status } : {}),
            degree: degreeIndex.get(name) ?? 0,
            defaultExpanded: false,
          };
        });

        featureCount += bucket.length;
        categoryNodes.push({
          id: `category:${mapping.category}`,
          kind: "category",
          label: mapping.label,
          count: bucket.length,
          depth: 3,
          children: entryNodes,
          ...(bucket.length > visible.length
            ? { subtitle: `另有 ${bucket.length - visible.length} 条未展开` }
            : {}),
          ...(mapping.webNovelSpecific ? { webNovelSpecific: true } : {}),
          // 分类层默认折叠：条目多时一次全画必糊
          defaultExpanded: false,
        });
      }

      if (categoryNodes.length === 0) {
        emptyFeatures.push({ feature: feature.id, label: feature.label, dimension: dimension.id });
        continue;
      }

      dimensionCount += featureCount;
      featureNodes.push({
        id: `feature:${feature.id}`,
        kind: "feature",
        label: feature.label,
        count: featureCount,
        depth: 2,
        children: categoryNodes,
        subtitle: feature.aspects.slice(0, 3).join(" · "),
        defaultExpanded: true,
      });
    }

    if (featureNodes.length === 0) continue;

    totalEntries += dimensionCount;
    dimensionNodes.push({
      id: `dimension:${dimension.id}`,
      kind: "dimension",
      label: dimension.label,
      count: dimensionCount,
      depth: 1,
      children: featureNodes,
      subtitle: dimension.question,
      defaultExpanded: true,
    });
  }

  // 未登记分类归入「其他」，不静默丢弃
  if (unknownCategory.length > 0) {
    const visible = unknownCategory.slice(0, maxEntries);
    totalEntries += unknownCategory.length;
    dimensionNodes.push({
      id: "dimension:other",
      kind: "dimension",
      label: "其他",
      count: unknownCategory.length,
      depth: 1,
      children: visible.map((entry) => ({
        id: `entry:${entry.id}`,
        kind: "entry" as const,
        label: trimLabel(entry.title, 24),
        count: 1,
        depth: 4,
        children: [],
        entryId: entry.id,
        ...(entryDetail(entry) ? { detail: entryDetail(entry) } : {}),
        defaultExpanded: false,
      })),
      subtitle: "未归入叙事分类的条目",
      defaultExpanded: false,
    });
  }

  return {
    root: {
      id: "root",
      kind: "root",
      label: "故事",
      count: totalEntries,
      depth: 0,
      children: dimensionNodes,
      defaultExpanded: true,
    },
    totalEntries,
    uncategorized: unknownCategory.length,
    emptyFeatures,
  };
}

// ─── 遍历辅助（组件渲染用） ────────────────────────────────────────────────

/** 扁平化成可见行（按展开状态）。tidy tree 布局前的第一步。 */
export function flattenVisible(
  node: StoryTreeNode,
  expanded: ReadonlySet<string>,
  rows: StoryTreeNode[] = [],
): StoryTreeNode[] {
  rows.push(node);
  const isExpanded = expanded.has(node.id) || (expanded.size === 0 && node.defaultExpanded);
  if (isExpanded) {
    for (const child of node.children) flattenVisible(child, expanded, rows);
  }
  return rows;
}

/** 初始展开集：按 defaultExpanded 递归收集。 */
export function initialExpandedIds(node: StoryTreeNode, into: Set<string> = new Set()): Set<string> {
  if (node.defaultExpanded) {
    into.add(node.id);
    for (const child of node.children) initialExpandedIds(child, into);
  }
  return into;
}

/** 按标签搜索命中的节点 id 及其祖先链（搜索时自动展开路径）。 */
export function idsMatchingQuery(node: StoryTreeNode, query: string, ancestors: string[] = []): Set<string> {
  const result = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (!needle) return result;
  const walk = (current: StoryTreeNode, chain: readonly string[]) => {
    const hit = current.label.toLowerCase().includes(needle)
      || (current.detail?.toLowerCase().includes(needle) ?? false);
    if (hit) {
      for (const id of chain) result.add(id);
      result.add(current.id);
    }
    for (const child of current.children) walk(child, [...chain, current.id]);
  };
  walk(node, ancestors);
  return result;
}
