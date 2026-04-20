import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDashed, Copy, LoaderCircle } from "lucide-react";

import type { ToolCall } from "@/stores/windowStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ToolIcon } from "./ToolIcon";
import { buildToolCallSummary, formatToolCallDuration, getToolCallStatusLabel } from "./tool-call-utils";

interface ToolCallBlockProps {
  toolCall: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
}

export function ToolCallBlock({ toolCall, defaultExpanded = false, className }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const summary = useMemo(() => buildToolCallSummary(toolCall), [toolCall]);
  const detailSections = useMemo(
    () => [
      {
        key: "command",
        label: "命令",
        value: toolCall.command,
      },
      {
        key: "input",
        label: "输入",
        value: stringifyDetail(toolCall.input),
      },
      {
        key: "output",
        label: "输出",
        value: toolCall.output,
      },
      {
        key: "result",
        label: "结果",
        value: stringifyDetail(toolCall.result),
      },
      {
        key: "error",
        label: "错误",
        value: toolCall.error,
        tone: "error" as const,
      },
    ].filter((section) => Boolean(section.value?.trim())),
    [toolCall],
  );

  const canExpand = detailSections.length > 0;
  const copyValue = detailSections.map((section) => `# ${section.label}\n${section.value}`).join("\n\n") || summary;
  const status = toolCall.status ?? "success";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card
      size="sm"
      className={cn(
        "border border-border/70 bg-card/80 shadow-none transition-colors",
        status === "error" && "border-destructive/40 bg-destructive/5",
        className,
      )}
    >
      <CardHeader className="gap-3 border-b border-border/50 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-border/70 bg-muted/50 p-2 text-muted-foreground">
              <ToolIcon name={toolCall.toolName} size={16} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">{toolCall.toolName}</CardTitle>
                <StatusBadge status={status} />
                {toolCall.exitCode !== undefined && toolCall.exitCode !== 0 && (
                  <Badge variant="destructive">Exit {toolCall.exitCode}</Badge>
                )}
                {toolCall.duration !== undefined && (
                  <Badge variant="outline">{formatToolCallDuration(toolCall.duration)}</Badge>
                )}
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{summary}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={handleCopy} aria-label="复制工具调用摘要">
              {copied ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              {copied ? "已复制" : "复制"}
            </Button>
            {canExpand && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                aria-label={expanded ? "收起工具调用详情" : "展开工具调用详情"}
              >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {expanded ? "收起" : "展开"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && canExpand && (
        <CardContent className="space-y-3 pt-3">
          {detailSections.map((section) => (
            <DetailSection key={section.key} label={section.label} value={section.value!} tone={section.tone} />
          ))}
        </CardContent>
      )}
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
