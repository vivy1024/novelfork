import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Anchor,
  BarChart3,
  MessageSquare,
  Activity,
  Swords,
  TrendingUp,
  Palette,
  Loader2,
} from "lucide-react";

export interface WritingToolDefinition {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  requiresChapter?: boolean;
}

export interface WritingToolsPanelProps {
  bookId: string;
  currentChapter?: number;
  onRunTool: (toolId: string, endpoint: string, params: Record<string, unknown>) => Promise<unknown>;
}

const WRITING_TOOLS: WritingToolDefinition[] = [
  {
    id: "hooks",
    label: "章末钩子",
    description: "生成 3-5 个章末钩子方案",
    icon: <Anchor className="size-4" />,
    endpoint: "/api/books/:bookId/hooks/generate",
    requiresChapter: true,
  },
  {
    id: "rhythm",
    label: "段落节奏",
    description: "分析句长分布和节奏多样性",
    icon: <BarChart3 className="size-4" />,
    endpoint: "/api/books/:bookId/chapters/:ch/rhythm",
    requiresChapter: true,
  },
  {
    id: "dialogue",
    label: "对话比例",
    description: "计算对话占比和角色对话分布",
    icon: <MessageSquare className="size-4" />,
    endpoint: "/api/books/:bookId/chapters/:ch/dialogue",
    requiresChapter: true,
  },
  {
    id: "health",
    label: "全书健康",
    description: "人设一致性、伏笔回收率、AI味均值",
    icon: <Activity className="size-4" />,
    endpoint: "/api/books/:bookId/health",
  },
  {
    id: "conflicts",
    label: "矛盾地图",
    description: "主要/次要矛盾的辩证转化追踪",
    icon: <Swords className="size-4" />,
    endpoint: "/api/books/:bookId/conflicts/map",
  },
  {
    id: "arcs",
    label: "角色弧线",
    description: "角色成长弧线进度和 arc beat",
    icon: <TrendingUp className="size-4" />,
    endpoint: "/api/books/:bookId/arcs",
  },
  {
    id: "tone-check",
    label: "文风检测",
    description: "检测章节文风与声明基调的偏离度",
    icon: <Palette className="size-4" />,
    endpoint: "/api/books/:bookId/chapters/:ch/tone-check",
    requiresChapter: true,
  },
];

export function WritingToolsPanel({ bookId, currentChapter, onRunTool }: WritingToolsPanelProps) {
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ toolId: string; data: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun(tool: WritingToolDefinition) {
    if (runningTool) return;
    if (tool.requiresChapter && !currentChapter) {
      setError("请先选择一个章节");
      return;
    }

    setRunningTool(tool.id);
    setError(null);
    setLastResult(null);

    const endpoint = tool.endpoint
      .replace(":bookId", bookId)
      .replace(":ch", String(currentChapter ?? 1));

    try {
      const result = await onRunTool(tool.id, endpoint, { bookId, chapterNumber: currentChapter });
      setLastResult({ toolId: tool.id, data: result });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工具执行失败");
    } finally {
      setRunningTool(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="writing-tools-panel">
      <h3 className="text-xs font-medium text-muted-foreground">写作工具</h3>

      <div className="grid grid-cols-2 gap-2">
        {WRITING_TOOLS.map((tool) => {
          const disabled = runningTool !== null || (tool.requiresChapter && !currentChapter);
          return (
            <button
              key={tool.id}
              type="button"
              disabled={disabled}
              onClick={() => void handleRun(tool)}
              className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="shrink-0 mt-0.5 text-muted-foreground">{tool.icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{tool.label}</span>
                  {runningTool === tool.id && <Loader2 className="size-3 animate-spin text-blue-500" />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{tool.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {lastResult && (
        <div className="rounded-lg border border-border p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{WRITING_TOOLS.find((t) => t.id === lastResult.toolId)?.label ?? lastResult.toolId}</Badge>
            <span className="text-[10px] text-muted-foreground">执行完成</span>
          </div>
          <pre className="text-[11px] text-muted-foreground overflow-x-auto max-h-40 whitespace-pre-wrap">
            {typeof lastResult.data === "string" ? lastResult.data : JSON.stringify(lastResult.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
