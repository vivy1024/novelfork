/**
 * 故事树视图 —— 一份实现，三处共用。
 *
 *   ① 工作台「故事推进 › 树状图」（mode="full"，全屏）
 *   ② 对话里 lore.read 结果卡（mode="compact"，替掉原来的 generic 原始结构输出）
 *   ③ 对话里 memory.graph 结果卡（mode="compact"，替掉原来的三元组文本列表）
 *
 * 层级来自 NarraBench 分类学（book → Big-4 → 12 特征 → 分类 → 条目），
 * 不依赖 `story_jingwei_entry.parent_id`（实测 209 条全空）。
 *
 * 渲染选择：缩进式 node-link 树，而不是自由拓扑图。
 *   · Barlow & Neville 2001 / Stasko 2000【实证】：看「谁在谁下面」这类拓扑任务，
 *     node-link 树优于 treemap；看量值时相反。我们要看结构，所以用树。
 *   · SpaceTree (Plaisant 2002) / DOI Tree (Card & Nation 2002)【实证】：大树上
 *     渐进展开 + focus+context 优于一次性全画。故分类层默认折叠、按需展开。
 *   · Purchase 2002【实证】：减少边交叉收益最大——缩进树的连线天然零交叉，
 *     这是它比力导向更适合层级数据的根本原因。
 *
 * 关系网（网状、非层级）是另一个组件，用力导向。二者用联动而非合并。
 */

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleSlash,
  FileText,
  FolderTree,
  Layers,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  buildStoryTree,
  flattenVisible,
  idsMatchingQuery,
  initialExpandedIds,
  type BuildStoryTreeInput,
  type StoryTree,
  type StoryTreeNode,
} from "../../engine/narrative-taxonomy/story-tree";

export type StoryTreeViewMode = "full" | "compact";

export interface StoryTreeViewProps extends BuildStoryTreeInput {
  /** compact 用于对话工具卡（限高、更少默认展开）；full 用于工作台全屏。 */
  readonly mode?: StoryTreeViewMode;
  /** 点条目 → 打开经纬条目卡。 */
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  /** 选中节点变化 → 宿主可联动关系网高亮。 */
  readonly onSelectNode?: (node: StoryTreeNode | null) => void;
  /** 缺口提示里的「补这块」动作交给叙述者。 */
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly className?: string;
}

const KIND_INDENT = 16;

/** 不同层级用不同视觉权重，靠字号与颜色区分，不靠花哨图形。 */
const KIND_STYLE: Record<StoryTreeNode["kind"], string> = {
  root: "text-sm font-semibold",
  dimension: "text-sm font-semibold",
  feature: "text-xs font-medium",
  category: "text-xs",
  entry: "text-2xs",
};

const KIND_ICON: Record<StoryTreeNode["kind"], typeof Layers | null> = {
  root: FolderTree,
  dimension: Layers,
  feature: null,
  category: null,
  entry: FileText,
};

function TreeRow({
  node,
  expanded,
  selected,
  matched,
  onToggle,
  onSelect,
  onOpenEntry,
}: {
  node: StoryTreeNode;
  expanded: boolean;
  selected: boolean;
  matched: boolean;
  onToggle: (id: string) => void;
  onSelect: (node: StoryTreeNode) => void;
  onOpenEntry?: (entryId: string, label: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICON[node.kind];

  return (
    <div
      className={
        "group flex items-center gap-1 rounded px-1 py-0.5 transition-colors "
        + (selected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/60")
        + (matched ? " ring-1 ring-amber-500/40" : "")
      }
      style={{ paddingLeft: node.depth * KIND_INDENT + 4 }}
      data-testid={`story-tree-row-${node.id}`}
      data-kind={node.kind}
    >
      {hasChildren ? (
        <button
          type="button"
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={expanded ? `折叠 ${node.label}` : `展开 ${node.label}`}
          aria-expanded={expanded}
          data-testid={`story-tree-toggle-${node.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}

      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        data-testid={`story-tree-node-${node.id}`}
        onClick={() => {
          onSelect(node);
          if (node.kind === "entry" && node.entryId && onOpenEntry) {
            onOpenEntry(node.entryId, node.label);
          }
        }}
      >
        {Icon ? <Icon className="size-3 shrink-0 text-muted-foreground" /> : null}
        <span className={`min-w-0 truncate ${KIND_STYLE[node.kind]}`} title={node.detail ?? node.label}>
          {node.label}
        </span>
        {node.kind !== "entry" ? (
          <Badge variant="outline" className="h-4 shrink-0 px-1 text-2xs font-normal">
            {node.count}
          </Badge>
        ) : null}
        {node.webNovelSpecific ? (
          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-2xs">网文</Badge>
        ) : null}
        {node.degree !== undefined && node.degree > 0 ? (
          <span className="shrink-0 text-2xs text-muted-foreground">{node.degree} 关系</span>
        ) : null}
        {node.subtitle ? (
          <span className="hidden shrink-0 text-2xs text-muted-foreground sm:inline">{node.subtitle}</span>
        ) : null}
      </button>
    </div>
  );
}

/** 详情面板：Shneiderman 的 details-on-demand——概览里只放标题，细节点开才看。 */
function NodeInspector({ node }: { node: StoryTreeNode | null }) {
  if (!node) {
    return (
      <p className="p-3 text-2xs text-muted-foreground" data-testid="story-tree-inspector-empty">
        点左侧任一节点查看详情。
      </p>
    );
  }
  return (
    <div className="space-y-2 p-3" data-testid="story-tree-inspector">
      <div>
        <p className="text-xs font-semibold">{node.label}</p>
        {node.subtitle ? <p className="mt-0.5 text-2xs text-muted-foreground">{node.subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="h-4 px-1 text-2xs">{node.kind}</Badge>
        {node.kind !== "entry" ? (
          <Badge variant="outline" className="h-4 px-1 text-2xs">{node.count} 条</Badge>
        ) : null}
        {node.status ? <Badge variant="secondary" className="h-4 px-1 text-2xs">{node.status}</Badge> : null}
      </div>
      {node.detail ? (
        <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-2xs leading-relaxed text-muted-foreground">
          {node.detail}
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground">这个节点没有正文内容。</p>
      )}
    </div>
  );
}

/** 缺口提示：诚实显示哪些叙事维度完全没有内容，而不是假装分类齐全。 */
function GapNotice({
  tree,
  onSendToNarrator,
}: {
  tree: StoryTree;
  onSendToNarrator?: (message: string) => Promise<void> | void;
}) {
  if (tree.emptyFeatures.length === 0) return null;
  const labels = tree.emptyFeatures.map((item) => item.label).join(" / ");
  const prompt = `经纬里这些叙事维度还没有任何条目：${labels}。`
    + `请基于已有正文补齐（视角/文风这类可以从已写章节里归纳作者习惯），写入经纬对应类目并保持 needs-review 待我确认。`;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1.5"
      data-testid="story-tree-gaps"
    >
      <CircleSlash className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-2xs text-muted-foreground">
        还没有内容的维度：{labels}
      </span>
      {onSendToNarrator ? (
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto h-6 gap-1 px-1.5 text-2xs"
          data-testid="story-tree-fill-gap"
          onClick={() => void onSendToNarrator(prompt)}
        >
          <Sparkles className="size-3" /> 让叙述者补
        </Button>
      ) : null}
    </div>
  );
}

export function StoryTreeView({
  mode = "full",
  onOpenEntry,
  onSelectNode,
  onSendToNarrator,
  className,
  ...treeInput
}: StoryTreeViewProps) {
  const tree = useMemo(() => buildStoryTree(treeInput), [
    treeInput.entries,
    treeInput.relations,
    treeInput.dimensions,
    treeInput.maxEntriesPerCategory,
  ]);

  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpandedIds(tree.root));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // 搜索命中会连同祖先链一起加入展开集，路径自动打开
  const matched = useMemo(() => idsMatchingQuery(tree.root, query), [tree, query]);
  const effectiveExpanded = useMemo(() => {
    if (matched.size === 0) return expanded;
    return new Set([...expanded, ...matched]);
  }, [expanded, matched]);

  const rows = useMemo(() => flattenVisible(tree.root, effectiveExpanded), [tree, effectiveExpanded]);

  const nodeById = useMemo(() => {
    const index = new Map<string, StoryTreeNode>();
    const walk = (node: StoryTreeNode) => {
      index.set(node.id, node);
      for (const child of node.children) walk(child);
    };
    walk(tree.root);
    return index;
  }, [tree]);

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const select = useCallback((node: StoryTreeNode) => {
    setSelectedId(node.id);
    onSelectNode?.(node);
  }, [onSelectNode]);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    const walk = (node: StoryTreeNode) => {
      if (node.children.length > 0) all.add(node.id);
      for (const child of node.children) walk(child);
    };
    walk(tree.root);
    setExpanded(all);
  }, [tree]);

  if (tree.totalEntries === 0) {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center gap-2 p-6 text-center ${className ?? ""}`}
        data-testid="story-tree-empty"
      >
        <FolderTree className="size-6 text-muted-foreground/60" />
        <p className="text-xs font-medium">作品基础里还没有条目</p>
        <p className="max-w-xs text-2xs leading-relaxed text-muted-foreground">
          树的层级来自叙事分类，条目来自经纬。先建立角色、地点、设定等条目，或对已有正文跑一次拆书。
        </p>
      </div>
    );
  }

  const compact = mode === "compact";

  return (
    <div
      className={`flex min-h-0 flex-col gap-1.5 ${className ?? ""}`}
      data-testid="story-tree-view"
      data-mode={mode}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <FolderTree className="size-3.5 text-primary" />
        <span className="text-xs font-semibold">故事树</span>
        <span className="text-2xs text-muted-foreground">{tree.totalEntries} 条</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索节点"
              aria-label="搜索故事树"
              className="h-6 w-32 pl-6 text-2xs"
            />
          </div>
          {query ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 px-1 text-2xs"
              data-testid="story-tree-clear-search"
              onClick={() => setQuery("")}
            >
              <X className="size-3" />
            </Button>
          ) : null}
          {!compact ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 px-1.5 text-2xs"
              data-testid="story-tree-expand-all"
              onClick={expandAll}
            >
              全部展开
            </Button>
          ) : null}
        </div>
      </div>

      {query && matched.size === 0 ? (
        <p className="px-1 text-2xs text-muted-foreground" data-testid="story-tree-no-match">
          没有匹配「{query}」的节点。
        </p>
      ) : null}

      <div className={compact ? "flex min-h-0 gap-2" : "flex min-h-0 flex-1 gap-2"}>
        <div
          className={
            "min-w-0 flex-1 overflow-auto rounded-md border py-1 "
            + (compact ? "max-h-72" : "")
          }
          role="tree"
          aria-label="故事树"
        >
          {rows.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              expanded={effectiveExpanded.has(node.id)}
              selected={selectedId === node.id}
              matched={Boolean(query) && matched.has(node.id) && node.kind === "entry"}
              onToggle={toggle}
              onSelect={select}
              {...(onOpenEntry ? { onOpenEntry } : {})}
            />
          ))}
        </div>

        {/* compact 模式下详情面板收起，避免在对话气泡里挤成两栏 */}
        {!compact ? (
          <div className="w-64 shrink-0 overflow-y-auto rounded-md border">
            <NodeInspector node={selected} />
          </div>
        ) : null}
      </div>

      {compact && selected ? (
        <div className="shrink-0 rounded-md border">
          <NodeInspector node={selected} />
        </div>
      ) : null}

      <GapNotice tree={tree} {...(onSendToNarrator ? { onSendToNarrator } : {})} />
    </div>
  );
}

export default StoryTreeView;
