/**
 * TerminalListPanel — 终端列表面板
 *
 * 显示 Agent 创建和管理的终端进程列表（running / exited）。
 * 数据来自 GET /api/terminals。
 */

import { useEffect, useState } from "react";
import { Terminal, Trash2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TerminalInfo {
  id: string;
  name: string;
  status: "running" | "exited";
  cwd: string;
  createdAt: string;
  pid?: number;
}

export function TerminalListPanel() {
  const [running, setRunning] = useState<TerminalInfo[]>([]);
  const [exited, setExited] = useState<TerminalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTerminals = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/terminals");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { running: TerminalInfo[]; exited: TerminalInfo[] };
      setRunning(data.running ?? []);
      setExited(data.exited ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchTerminals(); }, []);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/terminals/${encodeURIComponent(id)}`, { method: "DELETE" });
      void fetchTerminals();
    } catch { /* ignore */ }
  };

  const total = running.length + exited.length;

  return (
    <div className="space-y-4 mt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {loading ? "加载中..." : `共 ${total} 个终端`}
        </p>
        <Button variant="ghost" size="icon-sm" onClick={() => void fetchTerminals()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!loading && total === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
          <Terminal className="size-8 opacity-40" />
          <p className="text-xs">暂无终端</p>
          <p className="text-[10px]">终端由 Agent 工具自动创建和管理</p>
        </div>
      )}

      {running.length > 0 && (
        <div>
          <p className="text-[11px] font-medium mb-1.5">运行中 · {running.length}</p>
          <ul className="space-y-1.5">
            {running.map((t) => (
              <TerminalItem key={t.id} terminal={t} />
            ))}
          </ul>
        </div>
      )}

      {exited.length > 0 && (
        <div>
          <p className="text-[11px] font-medium mb-1.5">已退出 · {exited.length}</p>
          <ul className="space-y-1.5">
            {exited.map((t) => (
              <TerminalItem key={t.id} terminal={t} onDelete={() => void handleDelete(t.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TerminalItem({ terminal, onDelete }: { terminal: TerminalInfo; onDelete?: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
      <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{terminal.name || terminal.id}</p>
        <p className="text-[10px] text-muted-foreground truncate">{terminal.cwd}</p>
      </div>
      <Badge variant={terminal.status === "running" ? "default" : "secondary"} className="text-[10px] shrink-0">
        {terminal.status === "running" ? "运行中" : "已退出"}
      </Badge>
      {onDelete && (
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive transition-colors"
          onClick={onDelete}
          aria-label={`删除终端 ${terminal.name || terminal.id}`}
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </li>
  );
}
