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
  Read: "Read file contents from the filesystem",
  Write: "Create or overwrite a file on the filesystem",
  Edit: "Modify existing file contents",
  Bash: "Execute a shell command",
  Glob: "Search for files matching a pattern",
  Grep: "Search for text content in files",
  EnterWorktree: "Create and enter a Git worktree",
  ExitWorktree: "Exit and optionally remove a Git worktree",
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
  const description = TOOL_DESCRIPTIONS[toolName] || "Execute a tool operation";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDangerous && <AlertTriangle className="text-yellow-500" size={20} />}
            Permission Required
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="font-medium text-lg">{toolName}</p>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            {isDangerous && (
              <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-2 flex items-center gap-2">
                <AlertTriangle size={16} />
                This tool can modify your system. Review carefully before approving.
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Parameters:</p>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64 border">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onDeny}>
            Deny
          </Button>
          <Button onClick={onApprove} variant={isDangerous ? "destructive" : "default"}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
