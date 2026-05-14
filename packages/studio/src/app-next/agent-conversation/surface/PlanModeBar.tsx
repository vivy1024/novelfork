import { Brain, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  isActive: boolean;
  onApprove: () => void;
  onExit: () => void;
}

export function PlanModeBar({ isActive, onApprove, onExit }: Props) {
  if (!isActive) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-800 text-xs">
      <Brain className="size-3.5 text-blue-500" />
      <span className="text-blue-700 dark:text-blue-300 font-medium">计划模式</span>
      <span className="text-blue-600/70 dark:text-blue-400/70">— Agent 只能读取和分析，不会修改文件</span>
      <span className="flex-1" />
      <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={onExit}>
        退出计划模式
      </Button>
      <Button size="sm" className="h-6 text-[11px] bg-blue-600 hover:bg-blue-700" onClick={onApprove}>
        <Play className="size-3 mr-1" />
        批准执行
      </Button>
    </div>
  );
}
