/**
 * Sidebar — 左侧导航面板
 *
 * 结构参考 NarraFork：
 * - 叙事线（书籍/章节资源树，可折叠）
 * - 叙述者（会话列表，可折叠）
 * - 底部固定：套路 / 设置
 */

import { useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight, MessageSquareText, Settings, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import studioPackageJson from "../../../package.json";

const STUDIO_VERSION = studioPackageJson.version;

/* ------------------------------------------------------------------ */
/*  Collapsible Section                                                */
/* ------------------------------------------------------------------ */

interface SidebarSectionProps {
  readonly title: string;
  readonly icon: ReactNode;
  readonly defaultOpen?: boolean;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

function SidebarSection({ title, icon, defaultOpen = true, actions, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {actions && (
          <span className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </button>
      {open && <div className="pl-2">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

export interface SidebarProps {
  /** 叙事线内容（书籍资源树） */
  readonly storylineContent?: ReactNode;
  /** 叙述者内容（会话列表） */
  readonly narratorContent?: ReactNode;
  /** 叙事线操作按钮 */
  readonly storylineActions?: ReactNode;
  /** 叙述者操作按钮 */
  readonly narratorActions?: ReactNode;
  /** 套路点击 */
  readonly onRoutinesClick?: () => void;
  /** 设置点击 */
  readonly onSettingsClick?: () => void;
}

export function Sidebar({
  storylineContent,
  narratorContent,
  storylineActions,
  narratorActions,
  onRoutinesClick,
  onSettingsClick,
}: SidebarProps) {
  return (
    <div className="flex h-full flex-col bg-card" data-testid="studio-sidebar">
      {/* 品牌 */}
      <div className="shrink-0 border-b border-border px-3 py-2" role="banner">
        <p className="text-sm font-semibold">NovelFork Studio</p>
      </div>

      {/* 可滚动区域 */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {/* 叙事线 */}
        <SidebarSection
          title="叙事线"
          icon={<BookOpen className="h-3.5 w-3.5" />}
          actions={storylineActions}
        >
          {storylineContent ?? (
            <p className="px-2 py-1 text-xs text-muted-foreground">暂无叙事线</p>
          )}
        </SidebarSection>

        {/* 叙述者 */}
        <SidebarSection
          title="叙述者"
          icon={<MessageSquareText className="h-3.5 w-3.5" />}
          actions={narratorActions}
        >
          {narratorContent ?? (
            <p className="px-2 py-1 text-xs text-muted-foreground">暂无活跃会话</p>
          )}
        </SidebarSection>
      </div>

      {/* 底部固定 */}
      <div className="shrink-0 space-y-0.5 border-t border-border px-2 py-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onRoutinesClick}
        >
          <Wrench className="h-4 w-4 shrink-0" />
          套路
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onSettingsClick}
        >
          <Settings className="h-4 w-4 shrink-0" />
          设置
        </button>
        <div className="px-2 pt-1 text-[10px] text-muted-foreground">
          v{STUDIO_VERSION}
        </div>
      </div>
    </div>
  );
}
