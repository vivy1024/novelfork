import type { ReactNode } from "react";

import { GitBranch, LayoutDashboard, PenTool, Search, Settings, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StudioNextRoute } from "../entry";

export const NEXT_OVERLAY_LAYER_CLASS = "z-[100]";

const ROUTES: ReadonlyArray<{ route: StudioNextRoute; label: string; icon: typeof LayoutDashboard }> = [
  { route: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { route: "workspace", label: "创作工作台", icon: PenTool },
  { route: "workflow", label: "工作流", icon: GitBranch },
  { route: "settings", label: "设置", icon: Settings },
  { route: "routines", label: "套路", icon: Wrench },
];

interface NextShellProps {
  readonly activeRoute: StudioNextRoute;
  readonly onRouteChange: (route: StudioNextRoute) => void;
  readonly children: ReactNode;
}

export function NextShell({ activeRoute, onRouteChange, children }: NextShellProps) {
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 左侧 sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card">
        {/* 品牌 */}
        <div className="px-4 py-3" role="banner">
          <p className="text-sm font-semibold">NovelFork Studio</p>
        </div>

        {/* 搜索 */}
        <button
          className="mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          onClick={() => onRouteChange("search")}
          type="button"
        >
          <Search className="h-4 w-4" />
          搜索…
        </button>

        {/* 导航 */}
        <nav aria-label="Studio Next 主导航" className="flex-1 space-y-0.5 px-2">
          {ROUTES.map((item) => (
            <button
              key={item.route}
              type="button"
              aria-current={activeRoute === item.route ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition",
                activeRoute === item.route
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => onRouteChange(item.route)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* 底部 */}
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          v0.0.1
        </div>
      </aside>

      {/* 右侧内容 */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-4">
          {children}
        </div>
      </main>
    </div>
  );
}

interface SectionLayoutProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly overlay?: ReactNode;
  readonly children: ReactNode;
}

export function SectionLayout({ title, description, actions, overlay, children }: SectionLayoutProps) {
  return (
    <section className="relative space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      {overlay && <div className={cn("fixed inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm", NEXT_OVERLAY_LAYER_CLASS)}>{overlay}</div>}
    </section>
  );
}

export interface SettingsSectionItem {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
}

interface SettingsLayoutProps {
  readonly title: string;
  readonly sections: readonly SettingsSectionItem[];
  readonly activeSectionId: string;
  readonly onSectionChange: (sectionId: string) => void;
  readonly children: ReactNode;
}

export function SettingsLayout({ title: _title, sections, activeSectionId, onSectionChange, children }: SettingsLayoutProps) {
  const groupedSections = sections.reduce<Array<{ group: string; sections: SettingsSectionItem[] }>>((groups, section) => {
    const group = section.group ?? "设置分区";
    const existing = groups.find((item) => item.group === group);
    if (existing) {
      existing.sections.push(section);
    } else {
      groups.push({ group, sections: [section] });
    }
    return groups;
  }, []);

  return (
    <div className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="设置分区" className="rounded-lg border border-border bg-card p-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">分区导航</div>
        <div className="space-y-2">
          {groupedSections.map(({ group, sections: groupSections }) => (
            <div key={group} className="space-y-0.5">
              <div className="px-2 text-[10px] font-semibold text-muted-foreground">{group}</div>
              {groupSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={section.id === activeSectionId ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition",
                    section.id === activeSectionId ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                  onClick={() => onSectionChange(section.id)}
                >
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="rounded-lg border border-border bg-card p-3">{children}</div>
    </div>
  );
}

interface ResourceWorkspaceLayoutProps {
  readonly explorer: ReactNode;
  readonly editor: ReactNode;
  readonly assistant: ReactNode;
}

export function ResourceWorkspaceLayout({ explorer, editor, assistant }: ResourceWorkspaceLayoutProps) {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      <aside aria-label="小说资源管理器" className="rounded-lg border border-border bg-card p-3">
        {explorer}
      </aside>
      <main aria-label="正文编辑区" className="rounded-lg border border-border bg-card p-4">
        {editor}
      </main>
      <aside aria-label="AI 与经纬面板" className="rounded-lg border border-border bg-card p-3">
        {assistant}
      </aside>
    </div>
  );
}
