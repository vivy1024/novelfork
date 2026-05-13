import { Copy, Trash2, GitBranch, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SelectionActionBarProps {
  count: number;
  onCopy: () => void;
  onDelete: () => void;
  onFork: () => void;
  onClear: () => void;
}

export function SelectionActionBar({ count, onCopy, onDelete, onFork, onClear }: SelectionActionBarProps) {
  if (count === 0) return null;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border bg-background/95 backdrop-blur px-4 py-2 shadow-lg">
      <span className="text-xs font-medium text-muted-foreground">
        已选 {count} 条
      </span>
      <div className="h-4 w-px bg-border" />
      <Button variant="ghost" size="sm" onClick={onCopy} className="gap-1.5 text-xs">
        <Copy className="size-3.5" /> 复制
      </Button>
      <Button variant="ghost" size="sm" onClick={onFork} className="gap-1.5 text-xs">
        <GitBranch className="size-3.5" /> 分叉
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="gap-1.5 text-xs text-destructive hover:text-destructive"
      >
        <Trash2 className="size-3.5" /> 删除
      </Button>
      <Button variant="ghost" size="icon" className="size-6" onClick={onClear}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
