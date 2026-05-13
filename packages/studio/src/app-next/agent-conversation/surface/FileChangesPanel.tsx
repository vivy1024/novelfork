import { useState, useEffect, useCallback } from "react";
import { FileText, FilePlus, FileX, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileChangeItem {
  path: string;
  type: "created" | "modified" | "deleted";
  timestamp: number;
}

interface FileChangesPanelProps {
  sessionId: string;
  className?: string;
}

function FileChangeIcon({ type }: { type: FileChangeItem["type"] }) {
  switch (type) {
    case "created": return <FilePlus className="size-3.5 text-green-500" />;
    case "modified": return <FileText className="size-3.5 text-yellow-500" />;
    case "deleted": return <FileX className="size-3.5 text-red-500" />;
  }
}

function shortPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : fullPath;
}

export function FileChangesPanel({ sessionId, className = "" }: FileChangesPanelProps) {
  const [changes, setChanges] = useState<FileChangeItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);

  const fetchChanges = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/file-changes`);
      if (res.ok) {
        const data = await res.json();
        setChanges(data.changes ?? []);
      }
    } catch { /* fetch failure is non-fatal */ }
  }, [sessionId]);

  useEffect(() => {
    fetchChanges();
    // Poll every 5s while panel is open
    const interval = setInterval(fetchChanges, 5000);
    return () => clearInterval(interval);
  }, [fetchChanges]);

  const handleRevert = useCallback(async (path: string) => {
    setReverting(path);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/file-changes/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        await fetchChanges();
      }
    } catch { /* revert failure handled by UI */ }
    setReverting(null);
  }, [sessionId, fetchChanges]);

  if (changes.length === 0) {
    return null;
  }

  return (
    <div className={`border-t border-border ${className}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>文件修改</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{changes.length}</span>
      </button>

      {expanded && (
        <div className="max-h-48 overflow-y-auto px-2 pb-2">
          {changes.map((change) => (
            <div
              key={`${change.path}-${change.timestamp}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 group"
            >
              <FileChangeIcon type={change.type} />
              <span className="flex-1 truncate font-mono text-[11px]" title={change.path}>
                {shortPath(change.path)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRevert(change.path)}
                disabled={reverting === change.path}
                title="恢复原始内容"
              >
                <RotateCcw className={`size-3 ${reverting === change.path ? "animate-spin" : ""}`} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
