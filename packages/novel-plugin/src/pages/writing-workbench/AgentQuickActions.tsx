/**
 * AgentQuickActions — Agent 对话面板快捷按钮组
 *
 * 根据 Agent 角色显示对应的快捷操作按钮。
 * 按钮点击后自动发送对应指令到 Agent 对话。
 */
import { Button } from "@/components/ui/button";
import {
  PenLine,
  FileText,
  Shield,
  Lightbulb,
  Anchor,
  Compass,
} from "lucide-react";

export interface AgentQuickActionsProps {
  agentRole: string;
  bookId: string;
  onSendMessage: (message: string) => void;
}

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  message: string;
}

const NOVELIST_ACTIONS: QuickAction[] = [
  { icon: <FileText className="size-3.5" />, label: "生成下一章", message: "请生成下一章内容" },
  { icon: <PenLine className="size-3.5" />, label: "续写", message: "请续写当前章节" },
  { icon: <Compass className="size-3.5" />, label: "规划", message: "请规划下一章的目标、节奏和情节点" },
  { icon: <Shield className="size-3.5" />, label: "审计", message: "请对最新章节进行连续性审校和 AI 味检测" },
  { icon: <Lightbulb className="size-3.5" />, label: "伏笔", message: "请分析当前可以埋设或回收的伏笔" },
  { icon: <Anchor className="size-3.5" />, label: "章末钩子", message: "请为最新章节生成章末钩子方案" },
];

const ROLE_ACTIONS: Record<string, QuickAction[]> = {
  novelist: NOVELIST_ACTIONS,
  writer: NOVELIST_ACTIONS,  // legacy
};

export function AgentQuickActions({ agentRole, bookId, onSendMessage }: AgentQuickActionsProps) {
  const actions = ROLE_ACTIONS[agentRole] ?? ROLE_ACTIONS.novelist;

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-muted/20 overflow-x-auto">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs shrink-0"
          onClick={() => onSendMessage(action.message)}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
