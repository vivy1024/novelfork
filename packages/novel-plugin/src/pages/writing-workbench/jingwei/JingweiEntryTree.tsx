import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Loader2, ChevronRight, ChevronDown, GripVertical } from "lucide-react";
import type { JingweiEntry } from "./hooks/useJingweiEntries";
import { getCategorySchema } from "./category-schemas";

interface TreeNode {
  entry: JingweiEntry;
  children: TreeNode[];
}

interface JingweiEntryTreeProps {
  category: string;
  entries: JingweiEntry[];
  loading: boolean;
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
  onCreateEntry: (title: string, parentId?: string) => void;
  onMoveEntry?: (entryId: string, newParentId: string | null) => void;
  bookId: string;
}

export function JingweiEntryTree({
  category,
  entries,
  loading,
  selectedEntryId,
  onSelectEntry,
  onCreateEntry,
  onMoveEntry,
}: JingweiEntryTreeProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const schema = getCategorySchema(category);

  const tree = useMemo(() => {
    const filtered = search.trim()
      ? entries.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()))
      : entries;

    // Build parent-child map
    const nodeMap = new Map<string, TreeNode>();
    for (const entry of filtered) {
      nodeMap.set(entry.id, { entry, children: [] });
    }

    const roots: TreeNode[] = [];
    for (const node of nodeMap.values()) {
      const parentId = (node.entry as { parentId?: string | null }).parentId;
      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }, [entries, search]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleCreate(parentId?: string) {
    const title = prompt("新建条目标题：");
    if (title?.trim()) onCreateEntry(title.trim(), parentId);
  }

  function handleDragStart(e: React.DragEvent, entryId: string) {
    e.dataTransfer.setData("text/plain", entryId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, targetId: string | null) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
  }

  function handleDrop(e: React.DragEvent, targetParentId: string | null) {
    e.preventDefault();
    setDragOverId(null);
    const entryId = e.dataTransfer.getData("text/plain");
    if (entryId && entryId !== targetParentId && onMoveEntry) {
      onMoveEntry(entryId, targetParentId);
    }
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 p-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium truncate">{schema?.name ?? category}</h3>
          <Button size="xs" variant="ghost" onClick={() => handleCreate()} title="新建条目">
            <Plus className="size-3" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Tree */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onDragOver={(e) => handleDragOver(e, null)}
        onDrop={(e) => handleDrop(e, null)}
        onDragLeave={handleDragLeave}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {search ? "无匹配结果" : "暂无条目"}
            </p>
            {!search && (
              <Button size="xs" variant="ghost" className="mt-2" onClick={() => handleCreate()}>
                <Plus className="size-3 mr-1" />
                创建第一个条目
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {tree.map((node) => (
              <TreeNodeItem
                key={node.entry.id}
                node={node}
                depth={0}
                expanded={expanded}
                toggleExpand={toggleExpand}
                selectedEntryId={selectedEntryId}
                onSelectEntry={onSelectEntry}
                onCreateChild={handleCreate}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragLeave}
                dragOverId={dragOverId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  selectedEntryId: string | null;
  onSelectEntry: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string | null) => void;
  onDrop: (e: React.DragEvent, parentId: string | null) => void;
  onDragLeave: () => void;
  dragOverId: string | null;
}

function TreeNodeItem({
  node,
  depth,
  expanded,
  toggleExpand,
  selectedEntryId,
  onSelectEntry,
  onCreateChild,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  dragOverId,
}: TreeNodeItemProps) {
  const { entry, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(entry.id);
  const isActive = selectedEntryId === entry.id;
  const isDragOver = dragOverId === entry.id;

  return (
    <li>
      <div
        className={`group flex items-center gap-0.5 rounded-md px-1 py-1 text-left transition-colors cursor-pointer ${
          isActive
            ? "bg-primary/10 border border-primary/20"
            : isDragOver
              ? "bg-accent/50 border border-accent"
              : "hover:bg-muted/50 border border-transparent"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        draggable
        onDragStart={(e) => onDragStart(e, entry.id)}
        onDragOver={(e) => { e.stopPropagation(); onDragOver(e, entry.id); }}
        onDrop={(e) => { e.stopPropagation(); onDrop(e, entry.id); }}
        onDragLeave={onDragLeave}
        onClick={() => onSelectEntry(entry.id)}
      >
        {/* Drag handle */}
        <GripVertical className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />

        {/* Expand/collapse */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleExpand(entry.id); }}
            className="shrink-0 p-0.5 rounded hover:bg-muted"
          >
            {isExpanded ? (
              <ChevronDown className="size-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Title */}
        <span className="text-xs font-medium truncate flex-1">{entry.title}</span>

        {/* Child count badge */}
        {hasChildren && (
          <Badge variant="secondary" className="text-[9px] shrink-0 px-1">
            {children.length}
          </Badge>
        )}

        {/* Add child button on hover */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCreateChild(entry.id); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted"
          title="新建子条目"
        >
          <Plus className="size-2.5 text-muted-foreground" />
        </button>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <ul className="relative ml-3 border-l border-border/50 space-y-0.5">
          {children.map((child) => (
            <TreeNodeItem
              key={child.entry.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              selectedEntryId={selectedEntryId}
              onSelectEntry={onSelectEntry}
              onCreateChild={onCreateChild}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragLeave={onDragLeave}
              dragOverId={dragOverId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
