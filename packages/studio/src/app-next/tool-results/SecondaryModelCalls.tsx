import { AlertTriangle, Bot, CheckCircle2, Clock3, Coins, MessagesSquare } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { readSecondaryModelCalls } from "./types";

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "耗时未知";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

/** 展示 Tool 内部由宿主模型执行的二次调用；不暴露 prompt 正文，只展示用途、模型、耗时与用量。 */
export function SecondaryModelCalls({ value }: { readonly value: unknown }) {
  const calls = readSecondaryModelCalls(value);
  if (calls.length === 0) return null;

  const totalTokens = calls.reduce((sum, call) => sum + (call.totalTokens ?? 0), 0);
  const totalDurationMs = calls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0);
  const failed = calls.filter((call) => call.status === "failed");

  return (
    <div data-slot="secondary-model-calls" data-testid="secondary-model-calls" className="flex flex-col gap-2">
      <Separator />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Bot className="size-3.5" />
        <span className="font-medium text-foreground">内部模型调用</span>
        <Badge variant="secondary">{calls.length} 次</Badge>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3" />
          {formatDuration(totalDurationMs)}
        </span>
        {totalTokens > 0 && (
          <span className="inline-flex items-center gap-1">
            <Coins className="size-3" />
            {totalTokens} tokens
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {calls.map((call, index) => (
          <li key={call.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {call.status === "completed" ? (
              <CheckCircle2 className="size-3.5 text-primary" />
            ) : (
              <AlertTriangle className="size-3.5 text-destructive" />
            )}
            <span className="text-foreground">{index + 1}. {call.purpose}</span>
            <Badge variant="outline">{call.provider}/{call.model}</Badge>
            <span>{formatDuration(call.durationMs)}</span>
            {call.messageCount !== null && (
              <span className="inline-flex items-center gap-1">
                <MessagesSquare className="size-3" />
                {call.messageCount} 条消息
              </span>
            )}
            {call.totalTokens !== null && <span>{call.totalTokens} tokens</span>}
          </li>
        ))}
      </ul>

      {failed.length > 0 && (
        <Alert>
          <AlertTitle>有 {failed.length} 次内部模型调用失败</AlertTitle>
          <AlertDescription>
            {failed.map((call) => call.error || `${call.purpose} 未返回结果`).join("；")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
