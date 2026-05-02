import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { AlertTriangle } from "lucide-react";

export interface PermissionPromptProps {
  open: boolean;
  toolName: string;
  params: Record<string, unknown>;
  onApprove: () => void;
  onDeny: () => void;
  onClose: () => void;
}

const DANGEROUS_TOOLS = ["Bash", "Write", "ExitWorktree"];

const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: "从文件系统读取文件内容",
  Write: "在文件系统中创建或覆盖文件",
  Edit: "修改已有文件内容",
  Bash: "执行 shell 命令",
  Glob: "按模式搜索文件",
  Grep: "在文件中搜索文本内容",
  EnterWorktree: "创建并进入 Git worktree",
  ExitWorktree: "退出并可选择移除 Git worktree",
};

export function PermissionPrompt({
  open,
  toolName,
  params,
  onApprove,
  onDeny,
  onClose
}: PermissionPromptProps) {
  const isDangerous = DANGEROUS_TOOLS.includes(toolName);
  const description = TOOL_DESCRIPTIONS[toolName] || "执行工具操作";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDangerous && <AlertTriangle className="text-yellow-500" size={20} />}
            需要权限确认
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="font-medium text-lg">{toolName}</p>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            {isDangerous && (
              <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-2 flex items-center gap-2">
                <AlertTriangle size={16} />
                此工具可能修改系统或工作区，请确认参数无误后再批准。
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-2">参数：</p>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64 border">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onDeny}>
            拒绝
          </Button>
          <Button onClick={onApprove} variant={isDangerous ? "destructive" : "default"}>
            批准
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
