/**
 * JingweiGraphWorkspace — 经纬图谱工作区
 *
 * 画布默认视图。左侧分类侧栏 + 右侧图谱/列表/时间线 + 底部视图切换。
 * 复用现有 JingweiCategorySidebar、JingweiGraphView、JingweiEntryList、JingweiProgressions。
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { Network, List, Clock, GitBranch, Swords, Loader2, User, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SimpleSelect } from "@/components/ui/simple-select";
import { JingweiCategorySidebar } from "./jingwei/JingweiCategorySidebar";
import { JingweiGraphView } from "./jingwei/JingweiGraphView";
import { JingweiEntryList } from "./jingwei/JingweiEntryList";
import { JingweiProgressions } from "./jingwei/JingweiProgressions";
import type { JingweiEntry } from "./jingwei/hooks/useJingweiEntries";
import type { JingweiProgression } from "./jingwei/hooks/useJingweiProgressions";

/* ─── 角色弧线视图 ─── */

interface CharacterArcsViewProps {
  bookId: string;
  entries: JingweiEntry[];
}

/** 变更类型 → 颜色映射 */
function getProgressionColor(fieldKey: string): string {
  const key = fieldKey.toLowerCase();
  if (key.includes("realm") || key.includes("境界") || key.includes("level") || key.includes("等级")) {
    return "bg-purple-500";
  }
  if (key.includes("relation") || key.includes("关系") || key.includes("ally") || key.includes("enemy")) {
    return "bg-blue-500";
  }
  return "bg-emerald-500";
}

function CharacterArcsView({ bookId, entries }: CharacterArcsViewProps) {
  const characterEntries = useMemo(
    () => entries.filter((e) => e.category === "character"),
    [entries]
  );

  const [progressionsMap, setProgressionsMap] = useState<Record<string, JingweiProgression[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (characterEntries.length === 0) return;
    let cancelled = false;
    setLoading(true);

    async function fetchAll() {
      const map: Record<string, JingweiProgression[]> = {};
      await Promise.all(
        characterEntries.map(async (entry) => {
          try {
            const res = await fetch(
              `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/progressions`
            );
            if (res.ok) {
              const data = await res.json();
              map[entry.id] = Array.isArray(data.progressions) ? data.progressions : [];
            } else {
              map[entry.id] = [];
            }
          } catch {
            map[entry.id] = [];
          }
        })
      );
      if (!cancelled) {
        setProgressionsMap(map);
        setLoading(false);
      }
    }

    void fetchAll();
    return () => { cancelled = true; };
  }, [bookId, characterEntries]);

  // 计算章节范围
  const allChapters = useMemo(() => {
    const chapters = new Set<number>();
    for (const progs of Object.values(progressionsMap)) {
      for (const p of progs) {
        if (p.chapterNumber != null) chapters.add(p.chapterNumber);
      }
    }
    const sorted = [...chapters].sort((a, b) => a - b);
    if (sorted.length === 0) return [1, 2, 3, 4, 5];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const result: number[] = [];
    for (let i = min; i <= max; i++) result.push(i);
    return result.length > 0 ? result : [1, 2, 3, 4, 5];
  }, [progressionsMap]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (characterEntries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <User className="mx-auto size-8 opacity-30 mb-2" />
          <p className="text-sm">暂无角色条目</p>
          <p className="text-xs mt-1 opacity-60">在经纬图谱中添加角色类条目后，弧线视图将展示其变化轨迹</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      {/* 图例 */}
      <div className="flex items-center gap-4 mb-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-purple-500" />
          境界变化
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-blue-500" />
          关系变化
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          状态变化
        </span>
      </div>

      {/* 时间线表头 */}
      <div className="flex items-stretch border-b border-border pb-1 mb-2">
        <div className="w-24 shrink-0 text-[10px] text-muted-foreground font-medium">角色</div>
        <div className="flex-1 flex items-end">
          {allChapters.map((ch) => (
            <div
              key={ch}
              className="flex-1 text-center text-[9px] text-muted-foreground"
            >
              {ch}
            </div>
          ))}
        </div>
      </div>

      {/* 每个角色一行 */}
      {characterEntries.map((entry) => {
        const progs = progressionsMap[entry.id] ?? [];
        return (
          <div key={entry.id} className="flex items-center min-h-[32px] border-b border-border/50 group">
            <div className="w-24 shrink-0 text-xs truncate pr-2" title={entry.title}>
              {entry.title}
            </div>
            <div className="flex-1 flex items-center relative">
              {/* 横线 */}
              <div className="absolute inset-x-0 top-1/2 h-px bg-border -translate-y-1/2" />
              {/* 章节格子 */}
              {allChapters.map((ch) => {
                const chapterProgs = progs.filter((p) => p.chapterNumber === ch);
                return (
                  <div key={ch} className="flex-1 flex items-center justify-center relative">
                    {chapterProgs.length > 0 && (
                      <div className="relative group/dot">
                        <div
                          className={cn(
                            "size-3 rounded-full border-2 border-background shadow-sm cursor-pointer transition-transform hover:scale-150",
                            getProgressionColor(chapterProgs[0].fieldKey)
                          )}
                        />
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/dot:block z-50 w-48 p-2 rounded-md bg-popover border border-border shadow-lg text-[10px]">
                          {chapterProgs.map((p) => (
                            <div key={p.id} className="mb-1 last:mb-0">
                              <span className={cn("inline-block size-1.5 rounded-full mr-1", getProgressionColor(p.fieldKey))} />
                              <span className="font-medium">{p.fieldKey}</span>
                              {p.oldValue && (
                                <span className="text-muted-foreground line-through ml-1">{p.oldValue}</span>
                              )}
                              <span className="mx-0.5">→</span>
                              <span>{p.newValue}</span>
                              {p.description && (
                                <p className="text-muted-foreground mt-0.5 pl-3">{p.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 无变更提示 */}
      {Object.values(progressionsMap).every((p) => p.length === 0) && (
        <p className="text-center text-xs text-muted-foreground mt-6 opacity-60">
          角色暂无演变记录，添加演变后将在此展示时间线
        </p>
      )}
    </div>
  );
}

/* ─── 矛盾地图视图 ─── */

interface ConflictsMapViewProps {
  bookId: string;
  entries: JingweiEntry[];
}

interface ConflictItem {
  id: string;
  title: string;
  protagonist: string;
  antagonist: string;
  stakes: string;
  resolutionState: "unresolved" | "in-progress" | "resolved";
  chapterStart?: number;
  chapterEnd?: number;
}

function parseConflictFromEntry(entry: JingweiEntry): ConflictItem {
  const fields = entry.fields as Record<string, string | number | undefined>;
  return {
    id: entry.id,
    title: entry.title,
    protagonist: (fields.protagonist as string) ?? (fields["主角"] as string) ?? "未知",
    antagonist: (fields.antagonist as string) ?? (fields["对手"] as string) ?? "未知",
    stakes: (fields.stakes as string) ?? (fields["赌注"] as string) ?? "未设定",
    resolutionState: parseResolutionState(fields.resolutionState ?? fields["状态"]),
    chapterStart: typeof fields.chapterStart === "number" ? fields.chapterStart : (typeof fields["起始章节"] === "number" ? fields["起始章节"] : undefined),
    chapterEnd: typeof fields.chapterEnd === "number" ? fields.chapterEnd : (typeof fields["结束章节"] === "number" ? fields["结束章节"] : undefined),
  };
}

function parseResolutionState(val: unknown): ConflictItem["resolutionState"] {
  const s = String(val ?? "").toLowerCase();
  if (s === "resolved" || s === "已解决") return "resolved";
  if (s === "in-progress" || s === "进行中") return "in-progress";
  return "unresolved";
}

const RESOLUTION_CONFIG: Record<ConflictItem["resolutionState"], { label: string; className: string }> = {
  unresolved: { label: "未解决", className: "bg-red-500/10 text-red-600 border-red-500/20" },
  "in-progress": { label: "进行中", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  resolved: { label: "已解决", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

function ConflictsMapView({ bookId, entries }: ConflictsMapViewProps) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function fetchConflicts() {
      // 先尝试专用 API
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/conflicts/map`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
            if (!cancelled) {
              setConflicts(data.conflicts);
              setLoading(false);
            }
            return;
          }
        }
      } catch { /* fallback below */ }

      // 回退：从 entries 中筛选 category=conflict
      const conflictEntries = entries.filter((e) => e.category === "conflict");
      if (!cancelled) {
        setConflicts(conflictEntries.map(parseConflictFromEntry));
        setLoading(false);
      }
    }

    void fetchConflicts();
    return () => { cancelled = true; };
  }, [bookId, entries]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <AlertTriangle className="mx-auto size-8 opacity-30 mb-2" />
          <p className="text-sm">暂无矛盾冲突</p>
          <p className="text-xs mt-1 opacity-60">在经纬图谱中添加冲突类条目后，矛盾地图将展示对抗结构</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      {conflicts.map((conflict) => {
        const config = RESOLUTION_CONFIG[conflict.resolutionState];
        return (
          <div
            key={conflict.id}
            className="rounded-lg border border-border bg-card p-3 hover:border-border/80 transition-colors"
          >
            {/* 标题行 */}
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium truncate">{conflict.title}</h4>
              <Badge variant="outline" className={cn("text-[10px] shrink-0 ml-2", config.className)}>
                {config.label}
              </Badge>
            </div>

            {/* 对抗双方 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                {conflict.protagonist}
              </span>
              <Swords className="size-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                {conflict.antagonist}
              </span>
            </div>

            {/* 赌注 */}
            <p className="text-[11px] text-muted-foreground mb-1">
              <span className="font-medium text-foreground/80">赌注：</span>
              {conflict.stakes}
            </p>

            {/* 章节范围 */}
            {(conflict.chapterStart != null || conflict.chapterEnd != null) && (
              <p className="text-[10px] text-muted-foreground">
                章节范围：第{conflict.chapterStart ?? "?"}章 — 第{conflict.chapterEnd ?? "?"}章
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");

  // 获取全部条目（不传 category 参数）
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`);
      if (res.ok) {
        const data = await res.json();
        setAllEntries(Array.isArray(data.entries) ? data.entries : []);
      } else {
        setFetchError(`加载失败 (${res.status})`);
      }
    } catch {
      setFetchError("网络错误，无法加载经纬数据");
    }
    setLoading(false);
  }, [bookId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // 按分类计数
  const entryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of allEntries) {
      const cat = (entry as { category?: string }).category ?? "unknown";
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [allEntries]);

  // 按可见性筛选
  const visibilityFilteredEntries = useMemo(() => {
    if (visibilityFilter === "all") return allEntries;
    return allEntries.filter((e) => e.visibility === visibilityFilter);
  }, [allEntries, visibilityFilter]);

  // 按当前选中分类过滤（图谱模式下传 "all" 显示全部）
  const filteredEntries = useMemo(() => {
    if (viewMode === "graph" || viewMode === "arcs" || viewMode === "conflicts") {
      // 图谱类视图显示全部条目，内部有二次筛选
      return visibilityFilteredEntries;
    }
    // 列表/时间线按分类过滤
    return visibilityFilteredEntries.filter(
      (e) => (e as { category?: string }).category === selectedCategory
    );
  }, [visibilityFilteredEntries, selectedCategory, viewMode]);

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
        {/* 错误提示 */}
        {fetchError && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <AlertTriangle className="mx-auto size-8 text-destructive opacity-60 mb-2" />
              <p className="text-sm text-muted-foreground">{fetchError}</p>
              <button
                onClick={() => void fetchAll()}
                className="mt-2 text-xs text-primary hover:underline"
              >
                点击重试
              </button>
            </div>
          </div>
        )}
        {/* 视图内容 */}
        {!fetchError && (
        <div className="flex-1 min-h-0">
          {viewMode === "graph" && (
            <JingweiGraphView
              bookId={bookId}
              entries={filteredEntries}
              category={selectedCategory}
              onNodeClick={handleSelectEntry}
              hideToolbar
            />
          )}
          {viewMode === "arcs" && (
            <CharacterArcsView bookId={bookId} entries={filteredEntries} />
          )}
          {viewMode === "conflicts" && (
            <ConflictsMapView bookId={bookId} entries={filteredEntries} />
          )}
          {viewMode === "list" && (
            <JingweiEntryList
              category={selectedCategory}
              entries={filteredEntries}
              loading={loading}
              selectedEntryId={selectedEntryId}
              onSelectEntry={handleSelectEntry}
              onCreateEntry={handleCreateEntry}
              bookId={bookId}
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
        )}

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
          <div className="mx-1 h-4 w-px bg-border" />
          <SimpleSelect
            value={visibilityFilter}
            onValueChange={setVisibilityFilter}
            options={[
              { value: "all", label: "全部" },
              { value: "global", label: "🌐 全局" },
              { value: "tracked", label: "👁 追踪" },
              { value: "nested", label: "🔗 嵌套" },
            ]}
            className="h-6 text-xs"
            aria-label="按可见性筛选"
          />
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {filteredEntries.length} 条目
          </span>
        </div>
      </div>
    </div>
  );
}
