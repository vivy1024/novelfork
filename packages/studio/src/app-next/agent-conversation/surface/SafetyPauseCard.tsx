/**
 * SafetyPauseCard — 安全暂停决策卡片
 *
 * 当收到 session:safety-pause 事件时显示。
 * 展示工具名称、截断的输入、拒绝原因，以及确认执行/拒绝按钮。
 * 用户决策后发送 session:safety-decision WebSocket 事件。
 */

import { useState } from "react";
import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface SafetyPauseEvent {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
}

interface Props {
  pause: SafetyPauseEvent;
  onDecision: (id: string, decision: "approve" | "reject") => void;
}

function truncateInput(input: Record<string, unknown>, maxLen = 200): string {
  if (input.command && typeof input.command === "string") {
    return input.command.length > maxLen ? input.command.slice(0, maxLen) + "..." : input.command;
  }
  if (input.path && typeof input.path === "string") {
    return input.path.length > maxLen ? input.path.slice(0, maxLen) + "..." : input.path;
  }
  const json = JSON.stringify(input, null, 2);
  return json.length > maxLen ? json.slice(0, maxLen) + "..." : json;
}

export function SafetyPauseCard({ pause, onDecision }: Props) {
  const [decided, setDecided] = useState<"approve" | "reject" | null>(null);

  const handleDecision = (decision: "approve" | "reject") => {
    setDecided(decision);
    onDecision(pause.id, decision);
  };

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${decided ? "opacity-60" : "border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20"}`}>
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-yellow-600 shrink-0" />
        <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">安全暂停</span>
        <Badge variant="secondary" className="text-[11px] font-mono">
          {pause.toolName}
        </Badge>
      </div>

      <pre className="text-xs bg-muted/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-24 overflow-y-auto">
        {truncateInput(pause.input)}
      </pre>

      <p className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium">拒绝原因：</span>{pause.reason}
      </p>

      {decided ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {decided === "approve" ? (
            <>
              <Check className="size-3 text-orange-500" />
              <span>已确认执行</span>
            </>
          ) : (
            <>
              <X className="size-3 text-gray-500" />
              <span>已拒绝</span>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs bg-orange-600 hover:bg-orange-700 text-white"
            onClick={() => handleDecision("approve")}
          >
            <Check className="size-3 mr-1" />
            确认执行
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => handleDecision("reject")}
          >
            <X className="size-3 mr-1" />
            拒绝
          </Button>
        </div>
      )}
    </div>
  );
}
