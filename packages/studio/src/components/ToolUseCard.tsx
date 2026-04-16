import { FileText, Edit, Search, Terminal, FolderGit2, Loader2, CheckCircle, XCircle, Code } from "lucide-react";

export interface ToolUseCardProps {
  toolName: string;
  params: Record<string, unknown>;
  status: "pending" | "success" | "error";
  timestamp: Date;
}

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Read: FileText,
  Write: Edit,
  Edit: Edit,
  Glob: Search,
  Grep: Search,
  Bash: Terminal,
  EnterWorktree: FolderGit2,
  ExitWorktree: FolderGit2,
  Execute: Code,
};

export function ToolUseCard({ toolName, params, status, timestamp }: ToolUseCardProps) {
  const Icon = TOOL_ICONS[toolName] || FileText;

  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-3 mb-2">
        <Icon size={20} className="text-muted-foreground" />
        <h3 className="font-medium">{toolName}</h3>
        {status === "pending" && <Loader2 size={16} className="animate-spin text-blue-500" />}
        {status === "success" && <CheckCircle size={16} className="text-green-500" />}
        {status === "error" && <XCircle size={16} className="text-red-500" />}
        <span className="text-xs text-muted-foreground ml-auto">
          {timestamp.toLocaleTimeString()}
        </span>
      </div>

      {/* 参数展示 */}
      <div className="text-sm text-muted-foreground space-y-1">
        {Object.entries(params).map(([key, value]) => {
          const valueStr = typeof value === "string" ? value : JSON.stringify(value);
          const displayValue = valueStr.length > 100 ? valueStr.slice(0, 100) + "..." : valueStr;

          return (
            <div key={key} className="flex gap-2">
              <span className="font-medium text-foreground">{key}:</span>
              <span className="break-all">{displayValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
