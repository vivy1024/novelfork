import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Anchor,
  BarChart3,
  MessageSquare,
  Activity,
  Swords,
  TrendingUp,
  Palette,
  Loader2,
  ShieldAlert,
  HeartPulse,
  PenLine,
  GitBranch,
  Store,
  Shield,
  Download,
} from "lucide-react";
import { AiTasteReport, type FilterReport } from "./AiTasteReport";
import { postApi } from "../../hooks/use-api";
import { ChapterHealthCard } from "./ChapterHealthCard";
import { PresetsPanel } from "./PresetsPanel";
import { BeatTemplateList } from "./BeatProgressBar";
import { InlineWritePanel } from "./InlineWritePanel";
import { VariantsPanel } from "./VariantsPanel";
import { CharacterArcsPanel } from "./CharacterArcsPanel";
import { StyleDriftPanel } from "./StyleDriftPanel";
import { TemplateMarketPanel } from "./TemplateMarketPanel";
import { CompliancePanel } from "./CompliancePanel";
import { ExportPanel } from "./ExportPanel";

export interface WritingToolDefinition {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  method?: "GET" | "POST";
  requiresChapter?: boolean;
}

export interface WritingToolsPanelProps {
  bookId: string;
  currentChapter?: number;
  chapterContent?: string;
  onRunTool: (toolId: string, endpoint: string, params: Record<string, unknown>, method?: "GET" | "POST") => Promise<unknown>;
}

const WRITING_TOOLS: WritingToolDefinition[] = [
  {
    id: "ai-taste",
    label: "AI 味检测",
    description: "检测文本中的 AI 生成痕迹并给出修复建议",
    icon: <ShieldAlert className="size-4" />,
    endpoint: "/api/filter/scan",
    method: "POST",
    requiresChapter: true,
  },
  {
    id: "hooks",
    label: "章末钩子",
    description: "生成 3-5 个章末钩子方案",
    icon: <Anchor className="size-4" />,
    endpoint: "/api/books/:bookId/hooks/generate",
    method: "POST",
    requiresChapter: true,
  },
  {
    id: "rhythm",
    label: "段落节奏",
    description: "分析句长分布和节奏多样性",
    icon: <BarChart3 className="size-4" />,
    endpoint: "/api/books/:bookId/chapters/:ch/rhythm",
    method: "POST",
    requiresChapter: true,
  },
  {
    id: "dialogue",
    label: "对话比例",
    description: "计算对话占比和角色对话分布",
    icon: <MessageSquare className="size-4" />,
    endpoint: "/api/books/:bookId/chapters/:ch/dialogue",
    method: "POST",
    requiresChapter: true,
  },
  {
    id: "health",
    label: "全书健康",
    description: "人设一致性、伏笔回收率、AI味均值",
    icon: <Activity className="size-4" />,
    endpoint: "/api/books/:bookId/health",
    method: "GET",
  },
  {
    id: "conflicts",
    label: "矛盾地图",
    description: "主要/次要矛盾的辩证转化追踪",
    icon: <Swords className="size-4" />,
    endpoint: "/api/books/:bookId/conflicts/map",
    method: "GET",
  },
  {
    id: "arcs",
    label: "角色弧线",
    description: "角色成长弧线进度和 arc beat",
    icon: <TrendingUp className="size-4" />,
    endpoint: "/api/books/:bookId/arcs",
    method: "GET",
  },
  {
    id: "tone-check",
    label: "文风检测",
    description: "检测章节文风与声明基调的偏离度",
    icon: <Palette className="size-4" />,
    endpoint: "/api/books/:bookId/chapters/:ch/tone-check",
    method: "POST",
    requiresChapter: true,
  },
];

export function WritingToolsPanel({ bookId, currentChapter, chapterContent, onRunTool }: WritingToolsPanelProps) {
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ toolId: string; data: unknown } | null>(null);
  const [aiTasteReport, setAiTasteReport] = useState<FilterReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRunAiTaste() {
    if (runningTool) return;
    if (!currentChapter) {
      setError("请先选择一个章节");
      return;
    }
    const text = chapterContent ?? "";
    if (!text.trim()) {
      setError("当前章节内容为空，无法检测");
      return;
    }

    setRunningTool("ai-taste");
    setError(null);
    setLastResult(null);
    setAiTasteReport(null);

    try {
      const res = await postApi<{ report: FilterReport }>("/api/filter/scan", {
        text,
        bookId,
        chapterNumber: currentChapter,
        persist: true,
      });
      setAiTasteReport(res.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 味检测失败");
    } finally {
      setRunningTool(null);
    }
  }
  const [showChapterHealth, setShowChapterHealth] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [activeSubPanel, setActiveSubPanel] = useState<"inline-write" | "variants" | "character-arcs" | "style-drift" | "template-market" | null>(null);

  async function handleRun(tool: WritingToolDefinition) {
    if (runningTool) return;

    // AI taste detection uses a dedicated flow
    if (tool.id === "ai-taste") {
      await handleRunAiTaste();
      return;
    }

    if (tool.requiresChapter && !currentChapter) {
      setError("请先选择一个章节");
      return;
    }

    setRunningTool(tool.id);
    setError(null);
    setLastResult(null);
    setAiTasteReport(null);

    const endpoint = tool.endpoint
      .replace(":bookId", bookId)
      .replace(":ch", String(currentChapter ?? 1));

    try {
      const result = await onRunTool(tool.id, endpoint, { bookId, chapterNumber: currentChapter }, tool.method ?? "POST");
      setLastResult({ toolId: tool.id, data: result });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工具执行失败");
    } finally {
      setRunningTool(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="writing-tools-panel">
      <Tabs defaultValue="tools">
        <TabsList className="w-full">
          <TabsTrigger value="tools">工具</TabsTrigger>
          <TabsTrigger value="beats">节拍表</TabsTrigger>
          <TabsTrigger value="presets">预设</TabsTrigger>
        </TabsList>

        <TabsContent value="tools">
          <div className="space-y-3 pt-2">
            {/* Sub-panels (inline write / variants) */}
            {activeSubPanel === "inline-write" && (
              <InlineWritePanel
                bookId={bookId}
                currentChapter={currentChapter}
                selectedText={chapterContent ? undefined : undefined}
                onClose={() => setActiveSubPanel(null)}
              />
            )}
            {activeSubPanel === "variants" && (
              <VariantsPanel
                bookId={bookId}
                currentChapter={currentChapter}
                onClose={() => setActiveSubPanel(null)}
              />
            )}
            {activeSubPanel === "character-arcs" && (
              <CharacterArcsPanel
                bookId={bookId}
                onClose={() => setActiveSubPanel(null)}
              />
            )}
            {activeSubPanel === "style-drift" && (
              <StyleDriftPanel
                bookId={bookId}
                chapterContent={chapterContent}
                onClose={() => setActiveSubPanel(null)}
              />
            )}
            {activeSubPanel === "template-market" && (
              <TemplateMarketPanel
                bookId={bookId}
                onClose={() => setActiveSubPanel(null)}
              />
            )}

            {/* Main tools grid (hidden when sub-panel is open) */}
            {activeSubPanel === null && (
              <>
            {/* Writing mode entry cards */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveSubPanel("inline-write")}
                className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left hover:bg-primary/10 transition-colors"
              >
                <span className="shrink-0 mt-0.5 text-primary"><PenLine className="size-4" /></span>
                <div className="min-w-0">
                  <span className="text-xs font-medium">选段写作</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">续写/扩写/补写</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveSubPanel("variants")}
                className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left hover:bg-primary/10 transition-colors"
              >
                <span className="shrink-0 mt-0.5 text-primary"><GitBranch className="size-4" /></span>
                <div className="min-w-0">
                  <span className="text-xs font-medium">多版本变体</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">生成多个改写版本对比</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveSubPanel("character-arcs")}
                className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left hover:bg-primary/10 transition-colors"
              >
                <span className="shrink-0 mt-0.5 text-primary"><TrendingUp className="size-4" /></span>
                <div className="min-w-0">
                  <span className="text-xs font-medium">角色弧线</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">角色成长弧线与节拍</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveSubPanel("style-drift")}
                className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left hover:bg-primary/10 transition-colors"
              >
                <span className="shrink-0 mt-0.5 text-primary"><Palette className="size-4" /></span>
                <div className="min-w-0">
                  <span className="text-xs font-medium">文风漂移</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">检测文风偏离基线程度</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveSubPanel("template-market")}
                className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-left hover:bg-primary/10 transition-colors col-span-2"
              >
                <span className="shrink-0 mt-0.5 text-primary"><Store className="size-4" /></span>
                <div className="min-w-0">
                  <span className="text-xs font-medium">模板市场</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">浏览推荐套装，一键导入预设组合</p>
                </div>
              </button>
            </div>

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

      {/* AI Taste Report */}
      {aiTasteReport && (
        <div className="rounded-lg border border-border p-3">
          <AiTasteReport report={aiTasteReport} />
        </div>
      )}

      {/* Generic tool results */}
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

            {/* 章节分析入口 */}
            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setShowChapterHealth(!showChapterHealth)}
                disabled={!currentChapter}
                className="flex items-center gap-2 w-full rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <HeartPulse className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <span className="text-xs font-medium">章节分析</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {currentChapter ? `综合分析第 ${currentChapter} 章节奏 + 对话` : "请先选择章节"}
                  </p>
                </div>
              </button>
            </div>

            {showChapterHealth && currentChapter && (
              <ChapterHealthCard bookId={bookId} chapterNumber={currentChapter} />
            )}

            {/* 发布检查 & 导出 */}
            <div className="border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowCompliance(!showCompliance)}
                  className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="shrink-0 mt-0.5 text-muted-foreground"><Shield className="size-4" /></span>
                  <div className="min-w-0">
                    <span className="text-xs font-medium">发布检查</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">合规 + AI 声明</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setShowExport(!showExport)}
                  className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="shrink-0 mt-0.5 text-muted-foreground"><Download className="size-4" /></span>
                  <div className="min-w-0">
                    <span className="text-xs font-medium">导出</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">TXT / Word / ePub</p>
                  </div>
                </button>
              </div>
            </div>

            {showCompliance && (
              <CompliancePanel bookId={bookId} onClose={() => setShowCompliance(false)} />
            )}

            {showExport && (
              <ExportPanel bookId={bookId} onClose={() => setShowExport(false)} />
            )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="beats">
          <div className="pt-2">
            <BeatTemplateList />
          </div>
        </TabsContent>

        <TabsContent value="presets">
          <div className="pt-2">
            <PresetsPanel bookId={bookId} currentChapter={currentChapter} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
