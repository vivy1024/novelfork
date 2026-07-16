import type { ReactNode, ComponentType } from "react";

import { ArrowLeft, BookOpen, ChevronRight, Home, MessageSquareText, Search, Settings, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import studioPackageJson from "../../../package.json";
import type { StudioNextRoute } from "../entry";

export const NEXT_OVERLAY_LAYER_CLASS = "z-[100]";

const ROUTES: ReadonlyArray<{ route: StudioNextRoute; label: string; icon: typeof Home; key: string }> = [
  { route: { kind: "home" }, label: "Agent Shell", icon: Home, key: "home" },
  { route: { kind: "book", bookId: "default" }, label: "创作工作台", icon: BookOpen, key: "book" },
  { route: { kind: "narrator", sessionId: "default" }, label: "叙述者", icon: MessageSquareText, key: "narrator" },
  { route: { kind: "settings" }, label: "设置", icon: Settings, key: "settings" },
  { route: { kind: "routines" }, label: "套路", icon: Wrench, key: "routines" },
];

interface NextShellProps {
  readonly activeRoute: StudioNextRoute;
  readonly onRouteChange: (route: StudioNextRoute) => void;
  readonly children: ReactNode;
}

const STUDIO_VERSION = studioPackageJson.version;

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
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          onClick={() => onRouteChange({ kind: "search" })}
        >
          <Search className="h-4 w-4" />
          搜索…
        </Button>

        {/* 导航 */}
        <nav aria-label="Studio Next 主导航" className="flex flex-1 flex-col gap-0.5 px-2">
          {ROUTES.map((item) => (
            <Button
              key={item.key}
              variant="ghost"
              size="sm"
              aria-current={activeRoute.kind === item.route.kind ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition",
                activeRoute.kind === item.route.kind
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => onRouteChange(item.route)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Button>
          ))}
        </nav>

        {/* 底部 */}
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          v{STUDIO_VERSION}
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
    <section className="relative flex h-full w-full flex-col overflow-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {overlay && <div className={cn("fixed inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm", NEXT_OVERLAY_LAYER_CLASS)}>{overlay}</div>}
    </section>
  );
}

export interface SettingsSectionItem {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly icon?: ComponentType<{ className?: string }>;
}

interface SettingsLayoutProps {
  readonly title: string;
  readonly sections: readonly SettingsSectionItem[];
  readonly activeSectionId: string;
  readonly onSectionChange: (sectionId: string) => void;
  readonly mobileDetailOpen?: boolean;
  readonly onMobileBack?: () => void;
  readonly children: ReactNode;
}

export function SettingsLayout({
  title,
  sections,
  activeSectionId,
  onSectionChange,
  mobileDetailOpen = true,
  onMobileBack,
  children,
}: SettingsLayoutProps) {
  const groupedSections = sections.reduce<Array<{ group: string; sections: SettingsSectionItem[] }>>((groups, section) => {
    const group = section.group ?? "设置分区";
    const existing = groups.find((item) => item.group === group);
    if (existing) existing.sections.push(section);
    else groups.push({ group, sections: [section] });
    return groups;
  }, []);
  const activeSection = sections.find((section) => section.id === activeSectionId);

  return (
    <div data-slot="settings-layout" className="flex h-full min-h-0 w-full bg-background" data-testid="settings-layout">
      <aside
        className={cn(
          "h-full min-h-0 w-full shrink-0 border-border bg-card md:block md:w-[220px] md:border-r",
          mobileDetailOpen ? "hidden" : "block",
        )}
      >
        <div className="border-b border-border px-4 py-3 md:hidden">
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <ScrollArea className="h-[calc(100%-53px)] md:h-full">
          <nav aria-label="设置分区" className="flex flex-col gap-5 p-3">
            {groupedSections.map(({ group, sections: groupSections }) => (
              <section key={group} aria-labelledby={`settings-group-${group}`} className="flex flex-col gap-1">
                <h2 id={`settings-group-${group}`} className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h2>
                <div className="flex flex-col gap-0.5">
                  {groupSections.map((section) => (
                    <Button
                      key={section.id}
                      variant="ghost"
                      size="sm"
                      aria-current={section.id === activeSectionId ? "page" : undefined}
                      className={cn(
                        "w-full justify-start gap-2 px-2 font-normal",
                        section.id === activeSectionId && "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary",
                      )}
                      onClick={() => onSectionChange(section.id)}
                    >
                      {section.icon ? <section.icon data-icon="inline-start" /> : null}
                      <span className="truncate">{section.label}</span>
                      <ChevronRight className="ml-auto md:hidden" aria-hidden="true" />
                    </Button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      <section
        aria-label="设置详情"
        className={cn("h-full min-h-0 min-w-0 flex-1 flex-col", mobileDetailOpen ? "flex" : "hidden md:flex")}
      >
        <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2 md:hidden">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="返回设置列表" onClick={onMobileBack}>
            <ArrowLeft />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{activeSection?.label ?? title}</h1>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-6 lg:px-8">{children}</div>
        </ScrollArea>
      </section>
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
    <div className="grid min-h-[calc(100vh-4rem)] gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_24rem]">
      <aside aria-label="小说资源管理器" className="rounded-lg border border-border bg-card p-3">
        {explorer}
      </aside>
      <main aria-label="正文编辑区" className="rounded-lg border border-border bg-card p-4">
        {editor}
      </main>
      <aside aria-label="叙述者会话" className="min-h-0 overflow-hidden rounded-lg border border-border bg-card">
        {assistant}
      </aside>
    </div>
  );
}
