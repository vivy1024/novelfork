/**
 * 统一空态、错误态、运行态和反馈组件。
 * 覆盖创作工作台、设置页、套路页三个主页面。
 */

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/** 空态：必须有 CTA 按钮引导用户下一步操作。 */
export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <button className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export interface InlineErrorProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

/** 行内错误：显示错误原因，可选重试按钮。 */
export function InlineError({ message, onRetry }: InlineErrorProps) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <span>{message}</span>
      {onRetry && (
        <button className="ml-2 text-xs underline hover:no-underline" onClick={onRetry} type="button">
          重试
        </button>
      )}
    </div>
  );
}

export interface RunStatusProps {
  readonly action: string;
  readonly running: boolean;
}

/** 运行态：显示当前动作名称和运行状态。 */
export function RunStatus({ action, running }: RunStatusProps) {
  if (!running) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
      <span>{action}</span>
    </div>
  );
}

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps {
  readonly state: SaveState;
  readonly error?: string;
}

/** 保存状态指示器。 */
export function SaveStatus({ state, error }: SaveStatusProps) {
  const label = state === "dirty" ? "未保存" : state === "saving" ? "保存中…" : state === "saved" ? "已保存" : state === "error" ? "保存失败" : "";
  if (state === "clean") return null;
  return (
    <span className={`text-xs ${state === "error" ? "text-destructive" : state === "saved" ? "text-green-600" : "text-muted-foreground"}`} title={error}>
      {label}
    </span>
  );
}

export interface ConnectionFeedbackProps {
  readonly status: "connected" | "disconnected" | "connecting" | "error";
  readonly label?: string;
}

/** 连接状态反馈。 */
export function ConnectionFeedback({ status, label }: ConnectionFeedbackProps) {
  const colors: Record<ConnectionFeedbackProps["status"], string> = {
    connected: "bg-green-500",
    disconnected: "bg-gray-400",
    connecting: "bg-yellow-500 animate-pulse",
    error: "bg-destructive",
  };
  const defaultLabels: Record<ConnectionFeedbackProps["status"], string> = {
    connected: "已连接",
    disconnected: "未连接",
    connecting: "连接中",
    error: "连接失败",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
      {label ?? defaultLabels[status]}
    </span>
  );
}
