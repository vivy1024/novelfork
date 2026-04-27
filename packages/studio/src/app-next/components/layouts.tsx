import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { StudioNextRoute } from "../entry";

export const NEXT_OVERLAY_LAYER_CLASS = "z-[100]";

const ROUTES: ReadonlyArray<{ route: StudioNextRoute; label: string }> = [
  { route: "workspace", label: "创作工作台" },
  { route: "settings", label: "设置" },
  { route: "routines", label: "套路" },
];

interface NextShellProps {
  readonly activeRoute: StudioNextRoute;
  readonly onRouteChange: (route: StudioNextRoute) => void;
  readonly status?: ReactNode;
  readonly children: ReactNode;
}

export function NextShell({ activeRoute, onRouteChange, status, children }: NextShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 px-5 py-3 backdrop-blur" role="banner">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">NovelFork Studio Next</p>
            <h1 className="text-xl font-semibold">小说创作工作台</h1>
          </div>
          <nav aria-label="Studio Next 主导航" className="flex items-center gap-2 rounded-xl border border-border bg-card p-1">
            {ROUTES.map((item) => (
              <button
                key={item.route}
                type="button"
                aria-current={activeRoute === item.route ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  activeRoute === item.route
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => onRouteChange(item.route)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="min-w-[9rem] text-right text-sm text-muted-foreground">{status ?? "旁路入口 /next"}</div>
        </div>
      </header>
      <div className="p-5">{children}</div>
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
    <section className="relative space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
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
  readonly status?: string;
}

interface SettingsLayoutProps {
  readonly title: string;
  readonly sections: readonly SettingsSectionItem[];
  readonly activeSectionId: string;
  readonly onSectionChange: (sectionId: string) => void;
  readonly children: ReactNode;
}

export function SettingsLayout({ title, sections, activeSectionId, onSectionChange, children }: SettingsLayoutProps) {
  return (
    <SectionLayout title={title} description="左侧固定分区导航，右侧只展示当前分区详情。">
      <div className="grid min-h-[36rem] gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="设置分区" className="rounded-2xl border border-border bg-card p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">分区导航</div>
          <div className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={section.id === activeSectionId ? "page" : undefined}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                  section.id === activeSectionId ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
                onClick={() => onSectionChange(section.id)}
              >
                <span>{section.label}</span>
                {section.status && <span className="text-xs opacity-80">{section.status}</span>}
              </button>
            ))}
          </div>
        </nav>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">{children}</div>
      </div>
    </SectionLayout>
  );
}

interface ResourceWorkspaceLayoutProps {
  readonly explorer: ReactNode;
  readonly editor: ReactNode;
  readonly assistant: ReactNode;
}

export function ResourceWorkspaceLayout({ explorer, editor, assistant }: ResourceWorkspaceLayoutProps) {
  return (
    <div className="grid min-h-[42rem] gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
      <aside aria-label="小说资源管理器" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        {explorer}
      </aside>
      <main aria-label="正文编辑区" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        {editor}
      </main>
      <aside aria-label="AI 与经纬面板" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        {assistant}
      </aside>
    </div>
  );
}
