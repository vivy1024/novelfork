/**
 * PermissionRequestCard — 权限决策确认卡片
 * 
 * 后端集成状态：
 * - session-tool-executor.ts 已实现 pending-confirmation 机制（通过 confirmation_required 事件）
 * - 当前通过 agent-turn-runtime 的 confirmation_required 事件触发
 * - session:permission-request WebSocket 事件已定义但尚未从后端发射
 * - 实际权限确认通过现有的 confirmationDecision 流程处理
 * 
 * TODO: 将 session-tool-executor 的 pending-confirmation 结果桥接为 session:permission-request 事件
 */

import { useState } from "react";
import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  classification?: string;
}

interface Props {
  request: PermissionRequest;
  onDecision: (requestId: string, decision: "allow" | "deny") => void;
}

const RISK_COLORS: Record<PermissionRequest["riskLevel"], string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const RISK_LABELS: Record<PermissionRequest["riskLevel"], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "危险",
};

function formatInput(input: Record<string, unknown>): string {
  if (input.command && typeof input.command === "string") return input.command;
  if (input.path && typeof input.path === "string") return input.path;
  return JSON.stringify(input, null, 2);
}

export function PermissionRequestCard({ request, onDecision }: Props) {
  const [decided, setDecided] = useState<"allow" | "deny" | null>(null);

  const handleDecision = (decision: "allow" | "deny") => {
    setDecided(decision);
    onDecision(request.id, decision);
  };

  const riskColor = RISK_COLORS[request.riskLevel];

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${decided ? "opacity-60" : "border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20"}`}>
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-orange-500 shrink-0" />
        <span className="text-sm font-medium">权限请求</span>
        <Badge variant="secondary" className="text-[11px] font-mono">
          {request.toolName}
        </Badge>
        <Badge variant="secondary" className={`text-[11px] ${riskColor}`}>
          {RISK_LABELS[request.riskLevel]}
        </Badge>
        {request.classification && (
          <Badge variant="outline" className="text-[11px]">
            {request.classification}
          </Badge>
        )}
      </div>

      <pre className="text-xs bg-muted/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono">
        {formatInput(request.input)}
      </pre>

      {request.reason && (
        <p className="text-xs text-muted-foreground">{request.reason}</p>
      )}

      {decided ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {decided === "allow" ? (
            <>
              <Check className="size-3 text-green-500" />
              <span>已允许</span>
            </>
          ) : (
            <>
              <X className="size-3 text-red-500" />
              <span>已拒绝</span>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={() => handleDecision("allow")}
          >
            <Check className="size-3 mr-1" />
            允许执行
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
            onClick={() => handleDecision("deny")}
          >
            <X className="size-3 mr-1" />
            拒绝
          </Button>
        </div>
      )}
    </div>
  );
}
