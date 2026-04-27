import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { StudioNextRoute } from "../entry";

export const NEXT_OVERLAY_LAYER_CLASS = "z-[100]";

const ROUTES: ReadonlyArray<{ route: StudioNextRoute; label: string }> = [
  { route: "dashboard", label: "仪表盘" },
  { route: "workspace", label: "创作工作台" },
  { route: "workflow", label: "工作流" },
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
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 px-4 py-2 backdrop-blur" role="banner">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">NovelFork Studio</p>
            <h1 className="text-lg font-semibold">小说创作工作台</h1>
          </div>
          <nav aria-label="Studio Next 主导航" className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {ROUTES.map((item) => (
              <button
                key={item.route}
                type="button"
                aria-current={activeRoute === item.route ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition",
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
          {status != null && <div className="text-right text-xs text-muted-foreground">{status}</div>}
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-4">{children}</div>
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

export function SettingsLayout({ title, sections, activeSectionId, onSectionChange, children }: SettingsLayoutProps) {
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
    <SectionLayout title={title} description="">
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
    <div className="grid min-h-[38rem] gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
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
