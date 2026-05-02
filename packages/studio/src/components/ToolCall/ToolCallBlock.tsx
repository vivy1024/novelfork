import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Copy,
  Expand,
  LoaderCircle,
  Play,
  ScrollText,
  TimerReset,
} from "lucide-react";

import type { StudioRun } from "@/shared/contracts";
import type { ToolCall } from "@/shared/session-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/hooks/use-api";
import { useRunDetails } from "@/hooks/use-run-events";
import { describeToolAccessReason, normalizeGovernanceSourceKey, type ToolAccessReasonKey } from "@/shared/tool-access-reasons";

import { ToolIcon } from "./ToolIcon";
import { getToolResultRenderer } from "./tool-result-renderer-registry";
import {
  buildToolCallSummary,
  buildToolCallTranscript,
  formatToolCallDuration,
  getToolCallKind,
  getToolCallPrimaryTarget,
  getToolCallStatusLabel,
  getToolCallTimelineLabel,
} from "./tool-call-utils";

interface ToolCallBlockProps {
  toolCall: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
  onReplay?: (toolCall: ToolCall) => void;
  onInspectRun?: (executionMeta: { runId: string; attempts?: number; traceEnabled?: boolean; dumpEnabled?: boolean }, toolCall: ToolCall) => void;
}

interface SourcePreview {
  title: string;
  target: string;
  locator: string;
  line?: number;
  requestPreview: string;
  snippet: string;
}

export function ToolCallBlock({ toolCall, defaultExpanded = false, className, onReplay, onInspectRun }: ToolCallBlockProps) {
  const Renderer = getToolResultRenderer(toolCall);
  if (Renderer) {
    return <Renderer toolCall={toolCall} defaultExpanded={defaultExpanded} className={className} />;
  }

  return <GenericToolCallBlock toolCall={toolCall} defaultExpanded={defaultExpanded} className={className} onReplay={onReplay} onInspectRun={onInspectRun} />;
}

function GenericToolCallBlock({ toolCall, defaultExpanded = false, className, onReplay, onInspectRun }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<"summary" | "command" | "output" | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false);
  const summary = useMemo(() => buildToolCallSummary(toolCall), [toolCall]);
  const toolKind = useMemo(() => getToolCallKind(toolCall.toolName), [toolCall.toolName]);
  const primaryTarget = useMemo(() => getToolCallPrimaryTarget(toolCall), [toolCall]);
  const detailSections = useMemo(() => buildDetailSections(toolCall, toolKind), [toolCall, toolKind]);
  const rawPayload = useMemo(() => buildRawPayload(toolCall), [toolCall]);
  const sourcePayload = useMemo(() => buildSourcePayload(toolCall, toolKind), [toolCall, toolKind]);
  const subagentCard = useMemo(() => (toolKind === "agent" ? buildSubagentCard(toolCall) : null), [toolCall, toolKind]);
  const governanceMeta = useMemo(() => extractToolGovernance(toolCall), [toolCall]);
  const executionMeta = useMemo(() => extractToolRunExecution(toolCall), [toolCall]);
  const liveRun = useRunDetails(executionMeta?.runId);
  const status = toolCall.status ?? "success";
  const timeline = useMemo(
    () => [
      toolCall.startedAt ? `开始 ${getToolCallTimelineLabel(toolCall.startedAt)}` : undefined,
      toolCall.finishedAt ? `结束 ${getToolCallTimelineLabel(toolCall.finishedAt)}` : undefined,
    ].filter((item): item is string => Boolean(item)),
    [toolCall.finishedAt, toolCall.startedAt],
  );

  const handleCopy = async (key: "summary" | "command" | "output", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  };

  const handleOpenInEditor = async () => {
    await fetchJson("/api/tools/open-in-editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: toolCall.toolName,
        params: asRecord(toolCall.input) ?? {},
        output: toolCall.output,
      }),
    });
  };

  const canExpand = detailSections.length > 0;
  const canReplay = Boolean(onReplay) && isReplayableToolCall(toolCall, toolKind);
  const hasSource = Boolean(sourcePayload);
  const highlightBadges = buildHighlightBadges(toolCall, toolKind, primaryTarget);

  useEffect(() => {
    if (!sourceOpen || !hasSource) {
      return;
    }

    let cancelled = false;
    setSourcePreviewLoading(true);
    void fetchJson<SourcePreview>("/api/tools/source-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: toolCall.toolName,
        params: asRecord(toolCall.input) ?? {},
        command: toolCall.command,
        output: toolCall.output,
      }),
    }).then((payload) => {
      if (cancelled) {
        return;
      }
      setSourcePreview(payload);
      setSourcePreviewLoading(false);
    }).catch(() => {
      if (cancelled) {
        return;
      }
      setSourcePreview(null);
      setSourcePreviewLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [hasSource, sourceOpen, toolCall]);

  return (
    <Card
      size="sm"
      className={cn(
        "border border-border/70 bg-card/80 shadow-none transition-colors",
        status === "error" && "border-destructive/40 bg-destructive/5",
        status === "running" && "border-primary/30 bg-primary/5",
        className,
      )}
    >
      <CardHeader className="gap-3 border-b border-border/50 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-border/70 bg-muted/50 p-2 text-muted-foreground">
              <ToolIcon name={toolCall.toolName} size={16} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">{toolCall.toolName}</CardTitle>
                <StatusBadge status={status} />
                <Badge variant="outline">{getKindLabel(toolKind)}</Badge>
                {toolCall.exitCode !== undefined && toolCall.exitCode !== 0 && (
                  <Badge variant="destructive">Exit {toolCall.exitCode}</Badge>
                )}
                {toolCall.duration !== undefined && (
                  <Badge variant="outline" className="gap-1">
                    <TimerReset className="size-3" />
                    {formatToolCallDuration(toolCall.duration)}
                  </Badge>
                )}
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{summary}</p>
              {highlightBadges.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {highlightBadges.map((badge) => (
                    <span
                      key={`${badge.label}-${badge.value}`}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        badge.tone === "error"
                          ? "border-destructive/30 bg-destructive/5 text-destructive"
                          : "border-border/70 bg-background text-muted-foreground",
                      )}
                      title={badge.value}
                    >
                      <span className="uppercase tracking-[0.14em] opacity-70">{badge.label}</span>
                      <span className="truncate">{badge.value}</span>
                    </span>
                  ))}
                </div>
              )}
              {subagentCard && <SubagentCard card={subagentCard} />}
              {governanceMeta ? <GovernanceCard governanceMeta={governanceMeta} /> : null}
              {(timeline.length > 0 || toolCall.error) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {timeline.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {toolCall.error?.trim() ? (
                    <span className="text-destructive">错误：{truncate(formatGovernanceReason(toolCall.error.trim()) ?? toolCall.error.trim(), 80)}</span>
                  ) : null}
                </div>
              )}
              {executionMeta?.runId ? <RunTrackingCard executionMeta={executionMeta} liveRun={liveRun} /> : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">透明化动作</span>
            <div
              role="group"
              aria-label="工具调用动作区"
              className="flex flex-wrap items-center justify-end gap-1 rounded-lg border border-border/60 bg-muted/20 p-1"
            >
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void handleCopy("summary", buildToolCallTranscript(toolCall) || summary)}
                aria-label="复制工具调用摘要"
              >
                {copiedKey === "summary" ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copiedKey === "summary" ? "已复制" : "复制"}
              </Button>
              {toolCall.command?.trim() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleCopy("command", toolCall.command!.trim())}
                  aria-label="复制工具命令"
                >
                  {copiedKey === "command" ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  命令
                </Button>
              ) : null}
              {toolCall.output?.trim() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleCopy("output", toolCall.output!.trim())}
                  aria-label="复制工具输出"
                >
                  {copiedKey === "output" ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  输出
                </Button>
              ) : null}
              {hasSource ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setSourceOpen(true)}
                  aria-label="查看源码"
                >
                  <ScrollText className="size-3.5" />
                  查看源码
                </Button>
              ) : null}
              {rawPayload ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setRawExpanded((prev) => !prev)}
                  aria-expanded={rawExpanded}
                  aria-label={rawExpanded ? "收起原始载荷" : "查看原始载荷"}
                >
                  {rawExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  原始载荷
                </Button>
              ) : null}
              {(canExpand || rawPayload) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setFullscreenOpen(true)}
                  aria-label="全屏查看"
                >
                  <Expand className="size-3.5" />
                  全屏查看
                </Button>
              ) : null}
              {executionMeta?.runId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onInspectRun?.(executionMeta, toolCall)}
                  aria-label="定位运行"
                >
                  <Play className="size-3.5" />
                  定位运行
                </Button>
              ) : null}
              {canReplay ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onReplay?.(toolCall)}
                  aria-label="重跑"
                >
                  <Play className="size-3.5" />
                  重跑
                </Button>
              ) : null}
              {canExpand && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setExpanded((prev) => !prev)}
                  aria-expanded={expanded}
                  aria-label={expanded ? "收起结果细节" : "展开结果细节"}
                >
                  {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  {expanded ? "收起结果细节" : "展开结果细节"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      {(expanded && canExpand) || rawExpanded ? (
        <CardContent className="space-y-3 pt-3">
          {expanded && canExpand
            ? detailSections.map((section) => (
                <DetailSection key={section.key} label={section.label} value={section.value} tone={section.tone} />
              ))
            : null}
          {rawExpanded && rawPayload ? <DetailSection label="原始载荷" value={rawPayload} /> : null}
        </CardContent>
      ) : null}

      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden" showCloseButton>
          <DialogHeader>
            <DialogTitle>工具源码</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-auto pr-1 text-sm">
            {sourcePreviewLoading ? <div className="text-xs text-muted-foreground">正在加载源码预览…</div> : null}
            {sourcePreview ? (
              <>
                <DetailSection label="定位信息" value={`${sourcePreview.target}\n${sourcePreview.locator}`} />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="xs" onClick={() => void handleOpenInEditor()}>
                    打开定位
                  </Button>
                </div>
                <DetailSection label="请求片段" value={sourcePreview.requestPreview} />
                <DetailSection label="源码片段" value={sourcePreview.snippet} />
              </>
            ) : null}
            {!sourcePreviewLoading && !sourcePreview ? <DetailSection label="请求片段" value={sourcePayload ?? "暂无源码信息"} /> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden" showCloseButton>
          <DialogHeader>
            <DialogTitle>工具调用全屏详情</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="details" className="min-h-0 flex-1 overflow-hidden">
            <TabsList variant="line" className="w-full justify-start rounded-none bg-transparent p-0">
              <TabsTrigger value="details" className="rounded-none px-3 py-2">结果细节</TabsTrigger>
              <TabsTrigger value="raw" className="rounded-none px-3 py-2">原始载荷</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="mt-3 space-y-3 overflow-auto pr-1">
              {detailSections.length > 0
                ? detailSections.map((section) => (
                    <DetailSection key={`fullscreen-${section.key}`} label={section.label} value={section.value} tone={section.tone} />
                  ))
                : <DetailSection label="结果细节" value="暂无结果细节" />}
            </TabsContent>
            <TabsContent value="raw" className="mt-3 overflow-auto pr-1">
              <DetailSection label="原始载荷" value={rawPayload ?? "暂无原始载荷"} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusBadge({ status }: { status: NonNullable<ToolCall["status"]> }) {
  const icon =
    status === "pending" ? (
      <CircleDashed className="size-3" />
    ) : status === "running" ? (
      <LoaderCircle className="size-3 animate-spin" />
    ) : status === "error" ? (
      <CircleAlert className="size-3" />
    ) : (
      <CheckCircle2 className="size-3" />
    );

  const variant = status === "error" ? "destructive" : status === "success" ? "secondary" : "outline";

  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {getToolCallStatusLabel(status)}
    </Badge>
  );
}

function DetailSection({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "error";
}) {
  return (
    <section className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <pre
        className={cn(
          "overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words",
          tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        )}
      >
        {value}
      </pre>
    </section>
  );
}

function SubagentCard({
  card,
}: {
  card: { title: string; summary?: string; fields: Array<{ label: string; value: string }> };
}) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="subagent-card">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">子代理卡片</Badge>
        <span className="text-xs font-medium text-foreground">{card.title}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {card.fields.map((field) => (
          <div key={`${field.label}-${field.value}`} className="rounded-md border border-border/60 bg-background/80 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{field.label}</div>
            <div className="truncate text-xs text-foreground" title={field.value}>{field.value}</div>
          </div>
        ))}
      </div>
      {card.summary ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{card.summary}</p> : null}
    </div>
  );
}

function buildSubagentCard(toolCall: ToolCall) {
  const input = asRecord(toolCall.input);
  const result = asRecord(toolCall.result);
  const title = pickFirstString(input, ["description", "task", "prompt"]) ?? toolCall.summary ?? "子代理任务";
  const fields = [
    pickFirstString(input, ["subagent_type", "agentType", "type"]) ? { label: "类型", value: pickFirstString(input, ["subagent_type", "agentType", "type"])! } : null,
    pickFirstString(input, ["model"]) ? { label: "模型", value: pickFirstString(input, ["model"])! } : null,
    pickFirstString(result, ["status", "state"]) ?? toolCall.status ? { label: "状态", value: pickFirstString(result, ["status", "state"]) ?? getToolCallStatusLabel(toolCall.status) } : null,
    pickFirstString(result, ["subagent_id", "task_id", "id"]) ? { label: "任务", value: pickFirstString(result, ["subagent_id", "task_id", "id"])! } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return {
    title,
    summary: pickFirstString(result, ["summary", "message", "content"]) ?? firstLine(toolCall.output),
    fields,
  };
}

function buildHighlightBadges(toolCall: ToolCall, toolKind: ReturnType<typeof getToolCallKind>, primaryTarget?: string) {
  const badges: Array<{ label: string; value: string; tone?: "error" }> = [];

  if (primaryTarget?.trim()) {
    badges.push({
      label: toolKind === "web" ? "目标" : toolKind === "mcp" ? "MCP" : "对象",
      value: truncate(primaryTarget.trim(), 56),
    });
  }

  if (toolKind === "bash" && toolCall.command?.trim()) {
    badges.push({ label: "命令", value: truncate(toolCall.command.trim(), 56) });
  }

  if (toolCall.output?.trim()) {
    badges.push({ label: "输出", value: summarizeLineCount(toolCall.output.trim()) });
  }

  if (toolCall.error?.trim()) {
    badges.push({ label: "错误", value: truncate(formatGovernanceReason(toolCall.error.trim()) ?? toolCall.error.trim(), 48), tone: "error" });
  }

  return badges.slice(0, 4);
}

function buildDetailSections(toolCall: ToolCall, toolKind: ReturnType<typeof getToolCallKind>) {
  const input = stringifyDetail(toolCall.input);
  const result = stringifyDetail(toolCall.result);

  const sections = [
    {
      key: "command",
      label: toolKind === "bash" ? "命令" : toolKind === "web" ? "请求描述" : "操作描述",
      value: toolCall.command,
    },
    {
      key: "input",
      label: toolKind === "read" || toolKind === "write" ? "输入参数 / 路径" : "输入参数",
      value: input,
    },
    {
      key: "output",
      label:
        toolKind === "bash"
          ? "标准输出"
          : toolKind === "read"
            ? "读取内容"
            : toolKind === "search"
              ? "搜索结果"
              : toolKind === "web"
                ? "网页响应"
                : toolKind === "mcp"
                  ? "服务响应"
                  : "输出",
      value: toolCall.output,
    },
    {
      key: "result",
      label: toolKind === "write" ? "执行回执" : "结果",
      value: result,
    },
    {
      key: "error",
      label: "错误",
      value: formatGovernanceReason(toolCall.error) ?? toolCall.error,
      tone: "error" as const,
    },
  ];

  return sections.filter(
    (section): section is { key: string; label: string; value: string; tone?: "error" } =>
      Boolean(section.value?.trim()),
  );
}

function buildRawPayload(toolCall: ToolCall) {
  const payload = {
    input: toolCall.input ?? null,
    result: toolCall.result ?? null,
  };

  if (payload.input == null && payload.result == null) {
    return undefined;
  }

  return JSON.stringify(payload, null, 2);
}

function buildSourcePayload(toolCall: ToolCall, toolKind: ReturnType<typeof getToolCallKind>) {
  const input = stringifyDetail(toolCall.input);
  const sourceSections = [
    toolKind === "bash" && toolCall.command?.trim()
      ? `# Bash\n${toolCall.command.trim()}`
      : undefined,
    toolKind === "mcp"
      ? buildMcpReplaySnippet(toolCall)
      : undefined,
    toolKind !== "bash" && toolKind !== "mcp"
      ? buildBuiltinReplaySnippet(toolCall)
      : undefined,
    input ? `# 输入参数\n${input}` : undefined,
  ].filter((section): section is string => Boolean(section));

  return sourceSections.length > 0 ? sourceSections.join("\n\n") : undefined;
}

function isReplayableToolCall(toolCall: ToolCall, toolKind: ReturnType<typeof getToolCallKind>) {
  if (toolCall.status !== "success") {
    return false;
  }

  if (toolKind === "mcp") {
    const input = asRecord(toolCall.input);
    return typeof input?.serverId === "string" && typeof input?.tool === "string";
  }

  if (["bash", "read", "write", "search", "web"].includes(toolKind)) {
    return true;
  }

  return false;
}

function buildBuiltinReplaySnippet(toolCall: ToolCall) {
  return [
    "POST /api/tools/execute",
    JSON.stringify(
      {
        toolName: toolCall.toolName,
        params: asRecord(toolCall.input) ?? {},
      },
      null,
      2,
    ),
  ].join("\n\n");
}

function buildMcpReplaySnippet(toolCall: ToolCall) {
  const input = asRecord(toolCall.input);
  const serverId = typeof input?.serverId === "string" ? input.serverId : "<server-id>";
  const tool = typeof input?.tool === "string" ? input.tool : toolCall.toolName;
  const args = asRecord(input?.arguments) ?? {};

  return [
    `POST /api/mcp/servers/${serverId}/call`,
    JSON.stringify(
      {
        tool,
        arguments: args,
      },
      null,
      2,
    ),
  ].join("\n\n");
}

function getKindLabel(toolKind: ReturnType<typeof getToolCallKind>) {
  switch (toolKind) {
    case "bash":
      return "Shell";
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "search":
      return "搜索";
    case "web":
      return "网页";
    case "mcp":
      return "MCP";
    case "agent":
      return "子代理";
    default:
      return "工具";
  }
}

function stringifyDetail(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeLineCount(value: string) {
  const lineCount = value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  return `${Math.max(lineCount, 1)} 行`;
}

function formatGovernanceSource(source: string | undefined): string | undefined {
  switch (normalizeGovernanceSourceKey(source)) {
    case "allowlist":
      return "允许列表";
    case "blocklist":
      return "拒绝列表";
    case "default":
      return "默认权限模式";
    case "builtin":
      return "内置工具规则";
    case "mcpStrategy":
      return "MCP 默认策略";
    default:
      return source ? "运行策略" : undefined;
  }
}

function formatGovernanceReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return reason
    .replace(/Tool falls back to defaultPermissionMode=ask/g, "工具按默认权限模式进入确认")
    .replace(/defaultPermissionMode=ask/g, "默认权限模式=需确认")
    .replace(/runtimeControls\.defaultPermissionMode/g, "默认权限模式")
    .replace(/runtimeControls\.toolAccess\.mcpStrategy/g, "MCP 默认策略")
    .replace(/runtimeControls\.toolAccess\.allowlist/g, "允许列表")
    .replace(/runtimeControls\.toolAccess\.blocklist/g, "拒绝列表")
    .replace(/\bask\b/g, "需确认")
    .replace(/\ballow\b/g, "直接允许")
    .replace(/\bdeny\b/g, "拒绝");
}

function GovernanceCard({
  governanceMeta,
}: {
  governanceMeta: { source?: string; reason?: string; reasonLabel: string; confirmationRequired?: boolean; allowed?: boolean };
}) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs" data-testid="tool-governance-card">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">治理解释</Badge>
        <span className="text-foreground">{governanceMeta.reasonLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {governanceMeta.source ? <span>来源：{governanceMeta.source}</span> : null}
        {governanceMeta.allowed === false ? <span>执行：拒绝</span> : null}
        {governanceMeta.confirmationRequired ? <span>执行：需确认</span> : null}
      </div>
      {governanceMeta.reason ? <div className="mt-2 text-muted-foreground">原因：{governanceMeta.reason}</div> : null}
    </div>
  );
}

function RunTrackingCard({
  executionMeta,
  liveRun,
}: {
  executionMeta: { runId: string; attempts?: number; traceEnabled?: boolean; dumpEnabled?: boolean };
  liveRun: StudioRun | null;
}) {
  const chapterNumber = liveRun?.chapterNumber ?? liveRun?.chapter ?? null;
  const latestLog = liveRun && liveRun.logs.length > 0 ? liveRun.logs[liveRun.logs.length - 1]?.message : undefined;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs" data-testid="run-tracking-card">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">运行追踪</Badge>
        <span className="font-mono text-foreground">{executionMeta.runId}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {executionMeta.attempts !== undefined ? <span>尝试 {executionMeta.attempts} 次</span> : null}
        <span>trace {executionMeta.traceEnabled ? "开" : "关"}</span>
        <span>dump {executionMeta.dumpEnabled ? "开" : "关"}</span>
        {liveRun?.status ? <span>实时状态：{liveRun.status}</span> : null}
        {liveRun?.stage ? <span>阶段：{liveRun.stage}</span> : null}
        {liveRun?.bookId ? <span>书籍：{liveRun.bookId}</span> : null}
        {typeof chapterNumber === "number" ? <span>章节：第 {chapterNumber} 章</span> : null}
      </div>
      {latestLog ? <div className="mt-2 text-muted-foreground">最近日志：{latestLog}</div> : null}
      {liveRun?.error ? <div className="mt-2 text-destructive">{liveRun.error}</div> : null}
    </div>
  );
}

function extractToolRunExecution(toolCall: ToolCall) {
  const resultRecord = asRecord(toolCall.result);
  const executionRecord = asRecord(resultRecord?.execution) ?? resultRecord ?? undefined;
  const runId = typeof executionRecord?.runId === "string" ? executionRecord.runId : undefined;
  if (!runId || !executionRecord) {
    return null;
  }

  return {
    runId,
    attempts: typeof executionRecord.attempts === "number" ? executionRecord.attempts : undefined,
    traceEnabled: typeof executionRecord.traceEnabled === "boolean" ? executionRecord.traceEnabled : undefined,
    dumpEnabled: typeof executionRecord.dumpEnabled === "boolean" ? executionRecord.dumpEnabled : undefined,
  };
}

function extractToolGovernance(toolCall: ToolCall) {
  const resultRecord = asRecord(toolCall.result);
  const source = toolCall.source ?? (typeof resultRecord?.source === "string" ? resultRecord.source : undefined);
  const reason = toolCall.reason ?? (typeof resultRecord?.reason === "string" ? resultRecord.reason : undefined);
  const reasonKey = toolCall.reasonKey ?? (typeof resultRecord?.reasonKey === "string" ? resultRecord.reasonKey : undefined);
  const confirmationRequired = toolCall.confirmationRequired === true || resultRecord?.confirmationRequired === true;
  const allowed = typeof toolCall.allowed === "boolean"
    ? toolCall.allowed
    : typeof resultRecord?.allowed === "boolean"
      ? resultRecord.allowed
      : undefined;

  if (!source && !reason && !reasonKey && !confirmationRequired && allowed === undefined) {
    return null;
  }

  const formattedReason = formatGovernanceReason(reason);

  return {
    source: formatGovernanceSource(source),
    reason: formattedReason,
    confirmationRequired,
    allowed,
    reasonLabel: describeToolAccessReason(reasonKey as ToolAccessReasonKey | undefined, formattedReason ?? reason),
  };
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function pickFirstString(record: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstLine(value?: string) {
  return value?.split(/\r?\n/).find((line) => line.trim().length > 0);
}
