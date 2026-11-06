/**
 * 侧栏页头模具（设计板 sd-head）：图标 tile + 标题 + 一句用途说明 +（有的话）当前状态。
 *
 * 参照 docs/design/novelfork-frontend-final-board.html 屏 2/3/4。标题与活动栏视图名一致；
 * 用途说明写侧栏自己的口径，不照抄中央页那句；当前状态由面板按真实数据给出，没有就不传。
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SidebarPageHead({ icon: Icon, title, purpose, status, action }: {
  readonly icon: LucideIcon;
  readonly title: string;
  /** 一句用途说明：这个侧栏替作者干什么。 */
  readonly purpose: string;
  /** 当前状态（如「第 30 章 · 写作中」）；没有合适数据时不传。 */
  readonly status?: string | undefined;
  /** 右侧动作区（如「打开故事画布」）。 */
  readonly action?: ReactNode | undefined;
}) {
  const sub = status ? `${purpose} · 当前：${status}` : purpose;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-2.5 py-2" data-testid="sidebar-page-head">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="whitespace-nowrap text-xs font-semibold text-foreground" data-testid="sidebar-page-head-title">{title}</div>
        {/* 用途句是次要信息：小一号、单行截断，悬停看全文，不与标题抢视觉 */}
        <p className="mt-0.5 truncate text-2xs leading-snug text-muted-foreground" title={sub} data-testid="sidebar-page-head-sub">
          {sub}
        </p>
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
