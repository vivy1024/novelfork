import { useEffect, useState } from "react";
import { useColors } from "../hooks/use-colors";
import { fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { Activity, TrendingUp, AlertTriangle, CheckCircle2, Layers } from "lucide-react";

interface StateSnapshot {
  currentChapter: number;
  totalChapters: number;
  wordCount: number;
  activeHooks: number;
  unresolvedConflicts: number;
  resourceBalance: Record<string, number>;
  emotionalArcs: Array<{ character: string; state: string; trend: string }>;
  lastUpdated: string;
}

interface Props {
  bookId: string;
  nav: any;
  theme: Theme;
  t: TFunction;
}

export function StateProjectionsView({ bookId, nav, theme, t }: Props) {
  const c = useColors(theme);
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSnapshot();
  }, [bookId]);

  async function loadSnapshot() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<StateSnapshot>(`/api/books/${bookId}/state`);
      setSnapshot(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="w-4 h-4 animate-spin" />
          加载状态快照...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className={c.cardStatic}>
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div>
        <div className={c.cardStatic}>
          <p className="text-muted-foreground">无状态数据</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 text-foreground">
            状态投影
          </h1>
          <p className="text-sm text-muted-foreground">
            运行时状态快照 · 最后更新: {new Date(snapshot.lastUpdated).toLocaleString("zh-CN")}
          </p>
        </div>
        <button onClick={loadSnapshot} className={c.btnSecondary}>
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className={c.cardStatic}>
          <div className="flex items-center gap-3 mb-2">
            <Layers className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">章节进度</h3>
          </div>
          <div className="text-3xl font-bold mb-1 text-foreground">
            {snapshot.currentChapter} / {snapshot.totalChapters}
          </div>
          <div className="text-sm text-muted-foreground">
            {snapshot.wordCount.toLocaleString()} 字
          </div>
        </div>

        <div className={c.cardStatic}>
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className={`w-5 h-5 ${snapshot.activeHooks > 0 ? "text-yellow-500" : "text-green-500"}`} />
            <h3 className="font-semibold text-foreground">伏笔状态</h3>
          </div>
          <div className="text-3xl font-bold mb-1 text-foreground">
            {snapshot.activeHooks}
          </div>
          <div className="text-sm text-muted-foreground">
            活跃伏笔
          </div>
        </div>

        <div className={c.cardStatic}>
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className={`w-5 h-5 ${snapshot.unresolvedConflicts > 0 ? "text-red-500" : "text-green-500"}`} />
            <h3 className="font-semibold text-foreground">冲突追踪</h3>
          </div>
          <div className="text-3xl font-bold mb-1 text-foreground">
            {snapshot.unresolvedConflicts}
          </div>
          <div className="text-sm text-muted-foreground">
            未解决冲突
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={c.cardStatic}>
          <h3 className="font-semibold mb-4 flex items-center gap-2 text-foreground">
            <Activity className="w-5 h-5" />
            资源账本
          </h3>
          {Object.keys(snapshot.resourceBalance).length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无资源记录</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(snapshot.resourceBalance).map(([resource, balance]) => (
                <div key={resource} className="flex items-center justify-between p-2 rounded bg-secondary/50">
                  <span className="text-sm text-foreground">{resource}</span>
                  <span className={`text-sm font-mono ${balance >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {balance >= 0 ? "+" : ""}{balance}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={c.cardStatic}>
          <h3 className="font-semibold mb-4 flex items-center gap-2 text-foreground">
            <TrendingUp className="w-5 h-5" />
            情绪弧线
          </h3>
          {snapshot.emotionalArcs.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无情绪弧线数据</p>
          ) : (
            <div className="space-y-3">
              {snapshot.emotionalArcs.map((arc, idx) => (
                <div key={idx} className="p-3 rounded bg-secondary/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{arc.character}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      arc.trend === "up" ? "bg-green-500/20 text-green-500" :
                      arc.trend === "down" ? "bg-red-500/20 text-red-500" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {arc.trend === "up" ? "↑" : arc.trend === "down" ? "↓" : "→"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{arc.state}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={c.cardStatic + " mt-6"}>
        <div className="flex items-center gap-2 text-sm text-green-500">
          <CheckCircle2 className="w-4 h-4" />
          状态快照已同步
        </div>
      </div>
    </div>
  );
}
