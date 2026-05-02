import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface LogViewerProps {
  logs: string[];
}

export function LogViewer({ logs }: LogViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, collapsed]);

  const handleClear = () => {
    // 清空日志需要通过父组件状态管理
    console.log("请求清空日志");
  };

  return (
    <div className="flex flex-col border rounded-md">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">日志</span>
          <span className="text-xs text-muted-foreground">({logs.length})</span>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClear}
            className="h-7 px-2"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
            className="h-7 px-2"
          >
            {collapsed ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronUp className="w-3 h-3" />
            )}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <ScrollArea className="h-48" ref={scrollRef}>
          <div className="p-3 space-y-1 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-muted-foreground italic">暂无日志</div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="text-foreground/80">
                  {log}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
