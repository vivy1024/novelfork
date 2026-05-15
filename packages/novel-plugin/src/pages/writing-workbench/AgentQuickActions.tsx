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
  Scissors,
  Layers,
  Shield,
  Droplets,
  Lightbulb,
  Anchor,
  Network,
  RefreshCw,
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

const ROLE_ACTIONS: Record<string, QuickAction[]> = {
  writer: [
    { icon: <FileText className="size-3.5" />, label: "生成下一章", message: "请生成下一章内容" },
    { icon: <PenLine className="size-3.5" />, label: "续写", message: "请续写当前章节" },
    { icon: <Scissors className="size-3.5" />, label: "选段写作", message: "请对选中段落进行扩写" },
    { icon: <Layers className="size-3.5" />, label: "多版本", message: "请生成当前段落的多个改写版本" },
  ],
  auditor: [
    { icon: <Shield className="size-3.5" />, label: "连续性审校", message: "请对最新章节进行连续性审校" },
    { icon: <Droplets className="size-3.5" />, label: "AI味检测", message: "请检测最新章节的 AI 味" },
  ],
  hooks: [
    { icon: <Lightbulb className="size-3.5" />, label: "伏笔建议", message: "请分析当前可以埋设或回收的伏笔" },
    { icon: <Anchor className="size-3.5" />, label: "章末钩子", message: "请为最新章节生成章末钩子方案" },
  ],
  "chapter-hooks": [
    { icon: <Anchor className="size-3.5" />, label: "生成钩子", message: "请为最新章节生成章末钩子" },
    { icon: <FileText className="size-3.5" />, label: "应用钩子", message: "请将选中的钩子方案应用到章节末尾" },
  ],
  outline: [
    { icon: <Network className="size-3.5" />, label: "生成大纲", message: "请生成下一卷的大纲" },
    { icon: <RefreshCw className="size-3.5" />, label: "重建经纬", message: "请根据已有章节重建经纬资料" },
  ],
};

export function AgentQuickActions({ agentRole, bookId, onSendMessage }: AgentQuickActionsProps) {
  const actions = ROLE_ACTIONS[agentRole] ?? ROLE_ACTIONS.writer;

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
