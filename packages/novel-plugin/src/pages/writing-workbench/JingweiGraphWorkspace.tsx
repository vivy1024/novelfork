/**
 * JingweiGraphWorkspace — 经纬图谱工作区
 *
 * 画布默认视图。左侧分类侧栏 + 右侧图谱/列表/时间线 + 底部视图切换。
 * 复用现有 JingweiCategorySidebar、JingweiGraphView、JingweiEntryList、JingweiProgressions。
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { Network, List, Clock, GitBranch, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { JingweiCategorySidebar } from "./jingwei/JingweiCategorySidebar";
import { JingweiGraphView } from "./jingwei/JingweiGraphView";
import { JingweiEntryList } from "./jingwei/JingweiEntryList";
import { JingweiProgressions } from "./jingwei/JingweiProgressions";
import type { JingweiEntry } from "./jingwei/hooks/useJingweiEntries";

export type GraphViewMode = "graph" | "arcs" | "conflicts" | "list" | "timeline";

export interface JingweiGraphWorkspaceProps {
  bookId: string;
  onSelectNode?: (nodeId: string) => void;
}

const VIEW_MODES: { id: GraphViewMode; icon: React.ReactNode; label: string }[] = [
  { id: "graph", icon: <Network className="size-3" />, label: "图谱" },
  { id: "arcs", icon: <GitBranch className="size-3" />, label: "弧线" },
  { id: "conflicts", icon: <Swords className="size-3" />, label: "矛盾" },
  { id: "list", icon: <List className="size-3" />, label: "列表" },
  { id: "timeline", icon: <Clock className="size-3" />, label: "时间线" },
];

export function JingweiGraphWorkspace({ bookId, onSelectNode }: JingweiGraphWorkspaceProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("character");
  const [viewMode, setViewMode] = useState<GraphViewMode>("graph");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [allEntries, setAllEntries] = useState<JingweiEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // 获取全部条目（不传 category 参数）
  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`);
        if (res.ok) {
          const data = await res.json();
          setAllEntries(Array.isArray(data.entries) ? data.entries : []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    void fetchAll();
  }, [bookId]);

  // 按分类计数
  const entryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of allEntries) {
      const cat = (entry as { category?: string }).category ?? "unknown";
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [allEntries]);

  // 按当前选中分类过滤（图谱模式下传 "all" 显示全部）
  const filteredEntries = useMemo(() => {
    if (viewMode === "graph" || viewMode === "arcs" || viewMode === "conflicts") {
      // 图谱类视图显示全部条目，内部有二次筛选
      return allEntries;
    }
    // 列表/时间线按分类过滤
    return allEntries.filter(
      (e) => (e as { category?: string }).category === selectedCategory
    );
  }, [allEntries, selectedCategory, viewMode]);

  const handleSelectEntry = useCallback((entryId: string) => {
    setSelectedEntryId(entryId);
    onSelectNode?.(entryId);
  }, [onSelectNode]);

  const handleCreateEntry = useCallback(async (title: string) => {
    if (!title?.trim()) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: selectedCategory, title: title.trim(), fields: {} }),
      });
      if (res.ok) {
        const entry = await res.json();
        setAllEntries((prev) => [...prev, entry]);
      }
    } catch { /* ignore */ }
  }, [bookId, selectedCategory]);

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧分类侧栏 */}
      <JingweiCategorySidebar
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        entryCounts={entryCounts}
      />

      {/* 右侧主区域 */}
      <div className="flex flex-1 flex-col min-h-0">
        {/* 视图内容 */}
        <div className="flex-1 min-h-0">
          {viewMode === "graph" && (
            <JingweiGraphView
              bookId={bookId}
              entries={filteredEntries}
              category={selectedCategory}
              onNodeClick={handleSelectEntry}
            />
          )}
          {viewMode === "arcs" && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <GitBranch className="mx-auto size-10 opacity-30 mb-2" />
                <p className="text-sm">角色弧线视图</p>
                <p className="text-xs mt-1 opacity-60">按章节展示角色状态变化轨迹</p>
              </div>
            </div>
          )}
          {viewMode === "conflicts" && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Swords className="mx-auto size-10 opacity-30 mb-2" />
                <p className="text-sm">矛盾地图视图</p>
                <p className="text-xs mt-1 opacity-60">高亮冲突关系与对抗结构</p>
              </div>
            </div>
          )}
          {viewMode === "list" && (
            <JingweiEntryList
              category={selectedCategory}
              entries={filteredEntries}
              loading={loading}
              selectedEntryId={selectedEntryId}
              onSelectEntry={handleSelectEntry}
              onCreateEntry={handleCreateEntry}
            />
          )}
          {viewMode === "timeline" && selectedEntryId && (
            <div className="p-4 overflow-y-auto h-full">
              <JingweiProgressions
                bookId={bookId}
                entryId={selectedEntryId}
                category={selectedCategory}
              />
            </div>
          )}
          {viewMode === "timeline" && !selectedEntryId && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <p className="text-sm">选择一个条目查看变更时间线</p>
            </div>
          )}
        </div>

        {/* 底部视图切换 */}
        <div className="flex h-8 shrink-0 items-center gap-1 border-t border-border bg-muted/30 px-3">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setViewMode(mode.id)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors",
                viewMode === mode.id
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {mode.icon}
              {mode.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {allEntries.length} 条目
          </span>
        </div>
      </div>
    </div>
  );
}
