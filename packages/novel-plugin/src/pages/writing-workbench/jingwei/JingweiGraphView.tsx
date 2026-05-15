/**
 * JingweiGraphView — 经纬关系图谱视图
 * 使用 @xyflow/react 展示条目间的关系网络
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getCategorySchema, CATEGORY_SCHEMAS } from "./category-schemas";
import type { JingweiEntry } from "./hooks/useJingweiEntries";

// --- Types ---
interface JingweiRelation {
  id: string;
  sourceEntryId: string;
  targetEntryId: string;
  relationType: string;
  label?: string | null;
}

interface JingweiGraphViewProps {
  bookId: string;
  entries: JingweiEntry[];
  category: string;
  onNodeClick?: (entryId: string) => void;
  /** 隐藏内部分类筛选工具栏（外部已有侧栏时使用） */
  hideToolbar?: boolean;
}

// --- Relation type colors ---
const RELATION_COLORS: Record<string, string> = {
  "master-disciple": "#7c3aed",
  ally: "#16a34a",
  enemy: "#dc2626",
  lover: "#ec4899",
  "belongs-to": "#2563eb",
  "located-in": "#0d9488",
  "parent-child": "#6b7280",
  custom: "#ea580c",
};

const RELATION_TYPE_OPTIONS = [
  { value: "master-disciple", label: "师徒" },
  { value: "ally", label: "盟友" },
  { value: "enemy", label: "敌对" },
  { value: "lover", label: "情侣" },
  { value: "belongs-to", label: "从属" },
  { value: "located-in", label: "位于" },
  { value: "parent-child", label: "亲子" },
  { value: "custom", label: "自定义" },
];

const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "全部分类" },
  ...CATEGORY_SCHEMAS.map((s) => ({ value: s.id, label: s.name })),
];

// --- Lifecycle border colors ---
const LIFECYCLE_BORDER: Record<string, string> = {
  active: "border-green-500/50",
  dormant: "border-gray-400/50",
  retired: "border-red-500/50",
};

// --- Custom Node ---
function JingweiNode({ data }: { data: { label: string; category: string; preview: string; lifecycle?: string } }) {
  const schema = getCategorySchema(data.category);
  const borderClass = LIFECYCLE_BORDER[data.lifecycle ?? "active"] ?? LIFECYCLE_BORDER.active;
  return (
    <div className={`rounded-lg border ${borderClass} bg-card shadow-sm px-3 py-2 min-w-[120px] max-w-[180px]`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Badge variant="secondary" className="text-[9px] px-1">
          {schema?.name ?? data.category}
        </Badge>
      </div>
      <p className="text-xs font-medium truncate">{data.label}</p>
      {data.preview && (
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{data.preview}</p>
      )}
    </div>
  );
}

const nodeTypes = { jingweiNode: JingweiNode };

// --- Main Component ---
export function JingweiGraphView({ bookId, entries, category, onNodeClick, hideToolbar }: JingweiGraphViewProps) {
  const [relations, setRelations] = useState<JingweiRelation[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>(category);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [connectDialog, setConnectDialog] = useState<{ source: string; target: string } | null>(null);
  const [newRelationType, setNewRelationType] = useState("ally");

  // Fetch relations
  useEffect(() => {
    async function fetchRelations() {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/relations`);
        if (res.ok) {
          const data = await res.json();
          setRelations(Array.isArray(data.relations) ? data.relations : []);
        }
      } catch { /* ignore */ }
    }
    void fetchRelations();
  }, [bookId]);

  // Filter entries by category
  const filteredEntries = useMemo(() => {
    if (filterCategory === "all") return entries;
    return entries.filter((e) => (e as { category?: string }).category === filterCategory || e.category === filterCategory);
  }, [entries, filterCategory]);

  // Build nodes + edges
  useEffect(() => {
    const entryIds = new Set(filteredEntries.map((e) => e.id));
    const cols = Math.max(Math.ceil(Math.sqrt(filteredEntries.length)), 1);

    const newNodes: Node[] = filteredEntries.map((entry, i) => {
      const fields = entry.fields ?? {};
      const preview = (fields.description ?? fields.summary ?? fields.personality ?? fields.effect ?? "") as string;
      const lifecycle = ((fields.lifecycle ?? (entry as { lifecycle?: string }).lifecycle) ?? "active") as string;
      return {
        id: entry.id,
        type: "jingweiNode",
        position: { x: (i % cols) * 220, y: Math.floor(i / cols) * 120 },
        data: {
          label: entry.title,
          category: (entry as { category?: string }).category ?? category,
          preview: typeof preview === "string" ? preview.slice(0, 40) : "",
          lifecycle,
        },
      };
    });

    const newEdges: Edge[] = relations
      .filter((r) => entryIds.has(r.sourceEntryId) && entryIds.has(r.targetEntryId))
      .map((r) => ({
        id: r.id,
        source: r.sourceEntryId,
        target: r.targetEntryId,
        label: r.label ?? RELATION_TYPE_OPTIONS.find((o) => o.value === r.relationType)?.label ?? r.relationType,
        style: { stroke: RELATION_COLORS[r.relationType] ?? "#aaa", strokeWidth: 2 },
        animated: false,
      }));

    setNodes(newNodes);
    setEdges(newEdges);
  }, [filteredEntries, relations, category]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const onConnect: OnConnect = useCallback((connection) => {
    if (connection.source && connection.target) {
      setConnectDialog({ source: connection.source, target: connection.target });
    }
  }, []);

  async function handleCreateRelation() {
    if (!connectDialog) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEntryId: connectDialog.source,
          targetEntryId: connectDialog.target,
          relationType: newRelationType,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRelations((prev) => [...prev, data.relation]);
      }
    } catch { /* ignore */ }
    setConnectDialog(null);
    setNewRelationType("ally");
  }

  async function handleDeleteRelation(relationId: string) {
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/relations/${encodeURIComponent(relationId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setRelations((prev) => prev.filter((r) => r.id !== relationId));
      }
    } catch { /* ignore */ }
  }

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      if (confirm("删除此关系？")) {
        void handleDeleteRelation(edge.id);
      }
    },
    [],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar (hidden when external sidebar provides category filtering) */}
      {!hideToolbar && (
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <SimpleSelect
          value={filterCategory}
          onValueChange={setFilterCategory}
          options={CATEGORY_FILTER_OPTIONS}
          className="w-32"
          aria-label="分类筛选"
        />
        <span className="text-xs text-muted-foreground">
          {filteredEntries.length} 节点 · {edges.length} 关系
        </span>
      </div>
      )}

      {/* Graph */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeContextMenu={onEdgeContextMenu}
          onNodeClick={(_event, node) => onNodeClick?.(node.id)}
          fitView
          minZoom={0.2}
          maxZoom={3}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeColor={() => "hsl(var(--primary))"}
            className="!bg-background border border-border rounded"
          />
        </ReactFlow>
      </div>

      {/* Create relation dialog */}
      <Dialog open={!!connectDialog} onOpenChange={(open) => { if (!open) setConnectDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建关系</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">关系类型</label>
              <SimpleSelect
                value={newRelationType}
                onValueChange={setNewRelationType}
                options={RELATION_TYPE_OPTIONS}
                className="w-full"
                aria-label="关系类型"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{entries.find((e) => e.id === connectDialog?.source)?.title ?? "源"}</span>
              <span>→</span>
              <span>{entries.find((e) => e.id === connectDialog?.target)?.title ?? "目标"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConnectDialog(null)}>取消</Button>
            <Button size="sm" onClick={handleCreateRelation}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
