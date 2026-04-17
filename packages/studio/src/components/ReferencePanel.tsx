/**
 * ReferencePanel — bottom panel with tabbed reference views.
 * Tabs: 设定文件 (truth files), 角色 (characters), 伏笔 (hooks)
 */

import { useState, useMemo } from "react";
import { BookOpen, Users, Anchor, Globe, Activity } from "lucide-react";
import { useApi } from "../hooks/use-api";

// --- Types ---

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
}

interface ReferencePanelProps {
  readonly height: number;
  readonly bookId?: string;
}

type RefTab = "truth" | "characters" | "hooks" | "lorebook" | "cadence";

// --- Main Component ---

export function ReferencePanel({ height, bookId }: ReferencePanelProps) {
  const [activeTab, setActiveTab] = useState<RefTab>("truth");

  const tabs: ReadonlyArray<{ id: RefTab; label: string; icon: React.ReactNode }> = [
    { id: "truth", label: "设定文件", icon: <BookOpen size={12} /> },
    { id: "characters", label: "角色", icon: <Users size={12} /> },
    { id: "hooks", label: "伏笔", icon: <Anchor size={12} /> },
    { id: "lorebook", label: "世界观", icon: <Globe size={12} /> },
    { id: "cadence", label: "节奏", icon: <Activity size={12} /> },
  ];

  return (
    <div
      style={{ height }}
      className="bg-background/50 flex flex-col overflow-hidden"
    >
      {/* Tab header */}
      <div className="px-2 flex items-center gap-0 border-b border-border/40 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === tab.id
                ? "text-foreground border-b-2 border-b-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        {!bookId && (
          <span className="ml-auto text-[10px] text-muted-foreground/50 pr-2">
            选择书籍以查看参考资料
          </span>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {!bookId ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground/40 italic">
            请先打开一本书
          </div>
        ) : (
          <>
            {activeTab === "truth" && <TruthTab bookId={bookId} />}
            {activeTab === "characters" && <CharactersTab bookId={bookId} />}
            {activeTab === "hooks" && <HooksTab bookId={bookId} />}
            {activeTab === "lorebook" && <LorebookTab bookId={bookId} />}
            {activeTab === "cadence" && <CadenceTab bookId={bookId} />}
          </>
        )}
      </div>
    </div>
  );
}

// --- Truth Files Tab ---

function TruthTab({ bookId }: { bookId: string }) {
  const { data, loading } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: fileData } = useApi<{ file: string; content: string | null }>(
    selected ? `/books/${bookId}/truth/${selected}` : null,
  );

  if (loading) {
    return <div className="p-3 text-xs text-muted-foreground">加载中...</div>;
  }

  if (!data?.files?.length) {
    return <div className="p-3 text-xs text-muted-foreground/50 italic">暂无设定文件</div>;
  }

  return (
    <div className="flex h-full">
      {/* File list */}
      <div className="w-40 shrink-0 border-r border-border/30 overflow-y-auto">
        {data.files.map((f) => (
          <button
            key={f.name}
            onClick={() => setSelected(f.name)}
            className={`w-full text-left px-3 py-1.5 text-[11px] truncate transition-colors ${
              selected === f.name
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            {f.name.replace(".md", "")}
          </button>
        ))}
      </div>
      {/* Content preview */}
      <div className="flex-1 overflow-y-auto p-3">
        {selected && fileData?.content ? (
          <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">
            {fileData.content}
          </pre>
        ) : (
          <div className="text-xs text-muted-foreground/40 italic">
            {selected ? "加载中..." : "点击左侧文件预览"}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Characters Tab ---

interface CharacterEntry {
  readonly name: string;
  readonly role?: string;
  readonly detail?: string;
}

function parseCharactersFromState(content: string): ReadonlyArray<CharacterEntry> {
  const chars: CharacterEntry[] = [];
  const lines = content.split("\n");
  let currentChar: { name: string; role?: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Match headers like "## 萧云" or "### 萧云（主角）"
    const headerMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headerMatch) {
      if (currentChar) {
        chars.push({
          name: currentChar.name,
          role: currentChar.role,
          detail: currentChar.lines.join("\n").trim().slice(0, 200),
        });
      }
      const raw = headerMatch[1]!.trim();
      const roleMatch = raw.match(/^(.+?)[（(](.+?)[）)]$/);
      currentChar = roleMatch
        ? { name: roleMatch[1]!.trim(), role: roleMatch[2]!.trim(), lines: [] }
        : { name: raw, lines: [] };
    } else if (currentChar) {
      currentChar.lines.push(line);
    }
  }
  if (currentChar) {
    chars.push({
      name: currentChar.name,
      role: currentChar.role,
      detail: currentChar.lines.join("\n").trim().slice(0, 200),
    });
  }
  return chars;
}

function CharactersTab({ bookId }: { bookId: string }) {
  const { data, loading } = useApi<{ file: string; content: string | null }>(
    `/books/${bookId}/truth/current_state.md`,
  );

  if (loading) {
    return <div className="p-3 text-xs text-muted-foreground">加载中...</div>;
  }

  const chars = data?.content ? parseCharactersFromState(data.content) : [];

  if (chars.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground/50 italic">
        未在 current_state.md 中检测到角色（使用 ## 标题标记角色）
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 p-3">
      {chars.map((ch) => (
        <div
          key={ch.name}
          className="rounded-lg border border-border/40 bg-card p-2.5 text-xs"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Users size={11} className="text-primary shrink-0" />
            <span className="font-medium text-foreground truncate">{ch.name}</span>
            {ch.role && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                {ch.role}
              </span>
            )}
          </div>
          {ch.detail && (
            <p className="text-muted-foreground leading-relaxed line-clamp-3">
              {ch.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Hooks Tab ---

interface HookEntry {
  readonly name: string;
  readonly status: string;
  readonly detail?: string;
}

function parseHooksFromContent(content: string): ReadonlyArray<HookEntry> {
  const hooks: HookEntry[] = [];
  const lines = content.split("\n");
  let currentHook: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headerMatch) {
      if (currentHook) {
        hooks.push(buildHookEntry(currentHook));
      }
      currentHook = { name: headerMatch[1]!.trim(), lines: [] };
    } else if (currentHook) {
      currentHook.lines.push(line);
    }
  }
  if (currentHook) {
    hooks.push(buildHookEntry(currentHook));
  }
  return hooks;
}

function buildHookEntry(raw: { name: string; lines: string[] }): HookEntry {
  const body = raw.lines.join("\n");
  // Try to detect status from content
  let status = "pending";
  if (/已回收|已兑现|resolved|payoff/i.test(body)) status = "resolved";
  else if (/进行中|推进|advancing/i.test(body)) status = "active";
  else if (/埋设|planted|pending/i.test(body)) status = "pending";

  return {
    name: raw.name,
    status,
    detail: body.trim().slice(0, 200),
  };
}

const hookStatusColors: Record<string, string> = {
  resolved: "bg-emerald-500/10 text-emerald-600",
  active: "bg-amber-500/10 text-amber-600",
  pending: "bg-muted text-muted-foreground",
};

const hookStatusLabels: Record<string, string> = {
  resolved: "已兑现",
  active: "进行中",
  pending: "待触发",
};

function HooksTab({ bookId }: { bookId: string }) {
  const { data, loading } = useApi<{ file: string; content: string | null }>(
    `/books/${bookId}/truth/pending_hooks.md`,
  );

  if (loading) {
    return <div className="p-3 text-xs text-muted-foreground">加载中...</div>;
  }

  const hooks = data?.content ? parseHooksFromContent(data.content) : [];

  if (hooks.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground/50 italic">
        未在 pending_hooks.md 中检测到伏笔（使用 ## 标题标记伏笔）
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/30">
      {hooks.map((hook, i) => (
        <div key={i} className="px-3 py-2 flex items-start gap-2">
          <Anchor size={11} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground truncate">{hook.name}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${hookStatusColors[hook.status] ?? hookStatusColors.pending}`}>
                {hookStatusLabels[hook.status] ?? hook.status}
              </span>
            </div>
            {hook.detail && (
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{hook.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Lorebook Tab ---

interface LorebookEntryData {
  readonly id: number;
  readonly dimension: string;
  readonly name: string;
  readonly keywords: string;
  readonly content: string;
  readonly priority: number;
  readonly enabled: boolean;
}

interface DimensionData {
  readonly key: string;
  readonly label: string;
  readonly entryCount: number;
}

function LorebookTab({ bookId }: { bookId: string }) {
  const [selectedDim, setSelectedDim] = useState<string | null>(null);
  const { data: dimData, loading: dimLoading } = useApi<{ dimensions: ReadonlyArray<DimensionData> }>(
    `/books/${bookId}/lorebook/dimensions`,
  );
  const { data: entryData, loading: entryLoading } = useApi<{ entries: ReadonlyArray<LorebookEntryData>; total: number }>(
    selectedDim
      ? `/books/${bookId}/lorebook/entries?dimension=${selectedDim}`
      : `/books/${bookId}/lorebook/entries`,
  );

  if (dimLoading) {
    return <div className="p-3 text-xs text-muted-foreground">加载中...</div>;
  }

  const dimensions = dimData?.dimensions ?? [];
  const entries = entryData?.entries ?? [];
  const total = entryData?.total ?? 0;

  return (
    <div className="flex h-full">
      <div className="w-36 shrink-0 border-r border-border/30 overflow-y-auto">
        <button
          onClick={() => setSelectedDim(null)}
          className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
            selectedDim === null
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-secondary/50"
          }`}
        >
          全部 ({total})
        </button>
        {dimensions.map((dim) => (
          <button
            key={dim.key}
            onClick={() => setSelectedDim(dim.key)}
            className={`w-full text-left px-3 py-1.5 text-[11px] truncate transition-colors ${
              selectedDim === dim.key
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            {dim.label} ({dim.entryCount})
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {entryLoading ? (
          <div className="p-3 text-xs text-muted-foreground">加载中...</div>
        ) : entries.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground/50 italic">
            暂无世界观条目（通过 API 或导入功能添加）
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {entries.map((entry) => (
              <div key={entry.id} className="px-3 py-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Globe size={11} className="text-primary shrink-0" />
                  <span className="text-xs font-medium text-foreground">{entry.name}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">
                    {entry.dimension}
                  </span>
                  {!entry.enabled && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-500">禁用</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{entry.content}</p>
                {entry.keywords && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {entry.keywords.split(",").slice(0, 5).map((kw, i) => (
                      <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                        {kw.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Cadence Tab ---

interface CadenceRow {
  readonly chapter: number;
  readonly title: string;
  readonly mood: string;
  readonly chapterType: string;
}

interface CadenceSnapshot {
  readonly chapterSummaries?: { readonly rows?: ReadonlyArray<CadenceRow> };
}

const HIGH_TENSION_KEYWORDS = [
  "紧张", "冷硬", "压抑", "逼仄", "肃杀", "沉重", "凝重",
  "冷峻", "压迫", "阴沉", "焦灼", "窒息", "凛冽", "锋利",
  "克制", "危机", "对峙", "绷紧", "僵持", "杀意",
  "tense", "cold", "oppressive", "grim", "ominous", "dark",
  "bleak", "hostile", "threatening", "heavy", "suffocating",
];

function isHighTension(mood: string): boolean {
  const lower = mood.toLowerCase();
  return HIGH_TENSION_KEYWORDS.some((kw) => lower.includes(kw));
}

function computeScenePressure(rows: ReadonlyArray<CadenceRow>): number[] {
  const types = rows.map((r) => r.chapterType.trim().toLowerCase());
  return types.map((t, i) => {
    if (!t || t === "none" || t === "无") return 0;
    let streak = 1;
    for (let j = i - 1; j >= 0; j--) {
      if (types[j] === t) streak++;
      else break;
    }
    return Math.min(streak / 4, 1);
  });
}

function computeMoodPressure(rows: ReadonlyArray<CadenceRow>): number[] {
  return rows.map((r, i) => {
    const mood = r.mood.trim();
    if (!mood || mood === "none" || mood === "无") return 0.2;
    if (!isHighTension(mood)) return 0.2;
    let streak = 1;
    for (let j = i - 1; j >= 0; j--) {
      if (isHighTension(rows[j]!.mood)) streak++;
      else break;
    }
    return Math.min(streak / 5, 1);
  });
}

function computeTitleVariety(rows: ReadonlyArray<CadenceRow>): number[] {
  return rows.map((_, i) => {
    const window = rows.slice(Math.max(0, i - 4), i + 1);
    const titles = window.map((r) => r.title.trim()).filter(Boolean);
    if (titles.length < 2) return 0;
    const chars = new Set(titles.join("").split(""));
    const totalLen = titles.reduce((s, t) => s + t.length, 0);
    const ratio = chars.size / Math.max(totalLen, 1);
    return 1 - Math.min(ratio * 2, 1);
  });
}

function CadenceTab({ bookId }: { bookId: string }) {
  const { data, loading } = useApi<CadenceSnapshot>(`/books/${bookId}/state`);

  const rows = useMemo(() => {
    const raw = data?.chapterSummaries?.rows ?? [];
    return [...raw].sort((a, b) => a.chapter - b.chapter).slice(-20);
  }, [data]);

  const scene = useMemo(() => computeScenePressure(rows), [rows]);
  const mood = useMemo(() => computeMoodPressure(rows), [rows]);
  const title = useMemo(() => computeTitleVariety(rows), [rows]);

  if (loading) {
    return <div className="p-3 text-xs text-muted-foreground">加载中...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground/50 italic">
        暂无章节摘要数据（至少需要 2 章才能分析节奏）
      </div>
    );
  }

  const barW = Math.max(16, Math.min(40, Math.floor(600 / rows.length)));
  const chartH = 60;

  return (
    <div className="p-3 space-y-3 overflow-x-auto">
      <div className="text-[11px] text-muted-foreground mb-1">
        最近 {rows.length} 章节奏分析（压力越高 = 越需要变化）
      </div>
      {([
        { label: "场景重复", data: scene, color: "bg-blue-500" },
        { label: "情绪张力", data: mood, color: "bg-amber-500" },
        { label: "标题雷同", data: title, color: "bg-purple-500" },
      ] as const).map((dim) => (
        <div key={dim.label}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-2 h-2 rounded-full ${dim.color} shrink-0`} />
            <span className="text-[10px] font-medium text-foreground">{dim.label}</span>
          </div>
          <div className="flex items-end gap-px" style={{ height: chartH }}>
            {dim.data.map((v, i) => (
              <div
                key={rows[i]!.chapter}
                className="group relative flex flex-col items-center"
                style={{ width: barW }}
              >
                <div
                  className={`w-full rounded-t-sm transition-all ${
                    v > 0.7 ? dim.color : v > 0.4 ? `${dim.color}/60` : `${dim.color}/25`
                  }`}
                  style={{ height: Math.max(2, v * chartH) }}
                />
                <span className="text-[8px] text-muted-foreground/60 mt-0.5 leading-none">
                  {rows[i]!.chapter}
                </span>
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-10
                  bg-popover border border-border rounded px-2 py-1 text-[10px] text-foreground
                  shadow-md whitespace-nowrap pointer-events-none">
                  <div>第{rows[i]!.chapter}章: {rows[i]!.title || "—"}</div>
                  <div className="text-muted-foreground">
                    {dim.label === "场景重复" && `类型: ${rows[i]!.chapterType || "—"}`}
                    {dim.label === "情绪张力" && `情绪: ${rows[i]!.mood || "—"}`}
                    {dim.label === "标题雷同" && `压力: ${Math.round(v * 100)}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <CadenceLegend />
    </div>
  );
}

function CadenceLegend() {
  return (
    <div className="flex items-center gap-4 pt-1 border-t border-border/30 text-[9px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="w-3 h-2 rounded-sm bg-current opacity-25" /> 低
      </span>
      <span className="flex items-center gap-1">
        <span className="w-3 h-2 rounded-sm bg-current opacity-60" /> 中
      </span>
      <span className="flex items-center gap-1">
        <span className="w-3 h-2 rounded-sm bg-current" /> 高（需变化）
      </span>
    </div>
  );
}
