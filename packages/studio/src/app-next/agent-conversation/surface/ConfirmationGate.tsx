import { ShieldAlert, Check, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConversationConfirmationResource {
  kind: string;
  id: string;
  bookId?: string;
  title?: string;
}

export interface ConversationConfirmationSource {
  sessionId?: string;
  turnId?: string;
  messageId?: string;
  toolUseId?: string;
}

export interface ConversationConfirmationCheckpoint {
  required: boolean;
  checkpointId?: string;
  paths?: readonly string[];
}

export interface ConversationConfirmationOperation {
  action: string;
  label: string;
}

export interface ConversationConfirmationQuestionOption {
  label: string;
  description?: string;
}

export interface ConversationConfirmationQuestion {
  id: string;
  prompt: string;
  type: "text" | "single" | "multi" | "ranged-number" | "ai-suggest";
  options?: readonly (string | ConversationConfirmationQuestionOption)[];
  /** NarraFork 格式：短标签（如"节奏"、"视角"） */
  header?: string;
  reason?: string;
  required?: boolean;
  aiSuggestion?: string;
}

export interface ConversationConfirmation {
  id: string;
  title: string;
  toolName?: string;
  summary?: string;
  target?: string;
  targetResources?: readonly ConversationConfirmationResource[];
  risk?: string;
  permissionSource?: string;
  source?: ConversationConfirmationSource;
  checkpoint?: ConversationConfirmationCheckpoint;
  diff?: unknown;
  operations?: readonly ConversationConfirmationOperation[];
  operation?: string;
  error?: string;
  busy?: boolean;
  /** PGI/Guided 问题列表 */
  questions?: readonly ConversationConfirmationQuestion[];
}

const RISK_COLORS: Record<string, string> = {
  read: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "draft-write": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "confirmed-write": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  destructive: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

/**
 * Extract a pattern for "always allow this type" from the confirmation.
 * - Bash tools: first token + `*` (e.g. `git *`)
 * - File tools: directory + `/*`
 * - Otherwise: toolName + `:*`
 */
function extractAllowPattern(confirmation: ConversationConfirmation): string {
  const toolName = confirmation.toolName ?? "";
  const target = confirmation.target ?? "";

  // Bash-like: extract first command token
  if (/bash|shell|terminal|execute/i.test(toolName) && target) {
    const firstToken = target.trim().split(/\s+/)[0] ?? target;
    return `Bash:${firstToken} *`;
  }

  // File tools: use directory
  if (/read|write|edit|glob|grep/i.test(toolName) && target) {
    const lastSlash = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
    const dir = lastSlash > 0 ? target.slice(0, lastSlash) : target;
    return `${toolName}:${dir}/*`;
  }

  // Default: tool name wildcard
  return `${toolName || "unknown"}:*`;
}

export function ConfirmationGate({
  confirmation,
  onApprove,
  onReject,
  onAlwaysAllow,
}: {
  confirmation: ConversationConfirmation;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  /** Optional: called with the allow pattern when user clicks "始终允许此类" */
  onAlwaysAllow?: (id: string, pattern: string) => void;
}) {
  const riskClass = RISK_COLORS[confirmation.risk ?? ""] ?? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";

  return (
    <aside data-testid="confirmation-gate" className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950/30">
      {/* Header */}
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{confirmation.title}</h3>
            {confirmation.risk && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${riskClass}`}>
                {confirmation.risk}
              </span>
            )}
          </div>

          {confirmation.summary && (
            <p className="text-xs text-muted-foreground">{confirmation.summary}</p>
          )}

          {/* Details */}
          <div className="space-y-1 text-xs text-muted-foreground">
            {confirmation.target && (
              <div><span className="font-medium">目标：</span>{confirmation.target}</div>
            )}
            {confirmation.targetResources?.map((r) => (
              <div key={`${r.kind}:${r.id}`}>
                <span className="font-medium">资源：</span>
                <code className="rounded bg-muted px-1">{r.kind}</code> {r.title ?? r.id}
              </div>
            ))}
            {confirmation.checkpoint?.required && (
              <div><span className="font-medium">Checkpoint：</span>{confirmation.checkpoint.checkpointId ?? "将自动创建"}</div>
            )}
          </div>

          {/* Error */}
          {confirmation.error && (
            <div className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {confirmation.error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="default"
              size="sm"
              disabled={confirmation.busy}
              onClick={() => onApprove(confirmation.id)}
              className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700"
            >
              <Check className="size-3" />
              批准
            </Button>
            {onAlwaysAllow && (
              <Button
                variant="outline"
                size="sm"
                disabled={confirmation.busy}
                onClick={() => {
                  const pattern = extractAllowPattern(confirmation);
                  onAlwaysAllow(confirmation.id, pattern);
                }}
                className="inline-flex items-center gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
                title={`始终允许: ${extractAllowPattern(confirmation)}`}
              >
                <ShieldCheck className="size-3" />
                始终允许此类
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={confirmation.busy}
              onClick={() => onReject(confirmation.id)}
              className="inline-flex items-center gap-1"
            >
              <X className="size-3" />
              拒绝
            </Button>
            {confirmation.busy && <span className="text-[10px] text-muted-foreground">处理中...</span>}
          </div>
        </div>
      </div>
    </aside>
  );
}
