/**
 * StudioNextApp — NarraFork 风格布局
 *
 * 固定 sidebar（叙事线/叙述者/套路/设置）+ 全宽内容区。
 * 对话框路由下全宽渲染 WorkspacePage（含叙述者面板）。
 * 参考 reference/narrafork-frontend/layout-reference.md
 */

import { useCallback, useEffect, useState } from "react";

import { resolveStudioNextRoute, STUDIO_NEXT_BASE_PATH, type StudioNextRoute } from "./entry";
import { SettingsLayout } from "./components/layouts";
import { DashboardPage } from "./dashboard/DashboardPage";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { WorkspacePage } from "./workspace/WorkspacePage";
import { WorkflowPage } from "./workflow/WorkflowPage";
import { SearchPage } from "./search/SearchPage";
import { Sidebar } from "./sidebar/Sidebar";
import { StorylineTree, type BookListItem } from "./sidebar/StorylineTree";
import { NarratorList, NarratorActions, type NarratorSession } from "./sidebar/NarratorList";
import { useApi } from "../hooks/use-api";
import { User, Cpu, Bot, Bell, Palette, Plug, Server, Database, Activity, Clock, FolderCog, Info } from "lucide-react";

import type { NarratorSessionRecord } from "../shared/session-types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

interface StudioNextAppProps {
  readonly initialRoute?: StudioNextRoute;
}

const SETTINGS_SECTIONS = [
  { id: "profile", label: "个人资料", group: "个人设置", icon: User },
  { id: "models", label: "模型", group: "个人设置", icon: Cpu },
  { id: "agents", label: "AI 代理", group: "个人设置", icon: Bot },
  { id: "notifications", label: "通知", group: "个人设置", icon: Bell },
  { id: "appearance", label: "外观与界面", group: "个人设置", icon: Palette },
  { id: "providers", label: "AI 供应商", group: "实例管理", icon: Plug },
  { id: "server", label: "服务器与系统", group: "实例管理", icon: Server },
  { id: "storage", label: "存储空间", group: "实例管理", icon: Database },
  { id: "resources", label: "运行资源", group: "实例管理", icon: Activity },
  { id: "history", label: "使用历史", group: "实例管理", icon: Clock },
  { id: "config", label: "项目配置", group: "实例管理", icon: FolderCog },
  { id: "about", label: "关于", group: "实例管理", icon: Info },
] as const;

const ROUTE_PATHS: Record<StudioNextRoute, string> = {
  dashboard: `${STUDIO_NEXT_BASE_PATH}/dashboard`,
  workspace: STUDIO_NEXT_BASE_PATH,
  settings: `${STUDIO_NEXT_BASE_PATH}/settings`,
  routines: `${STUDIO_NEXT_BASE_PATH}/routines`,
  workflow: `${STUDIO_NEXT_BASE_PATH}/workflow`,
  search: `${STUDIO_NEXT_BASE_PATH}/search`,
};

/* ------------------------------------------------------------------ */
/*  StudioNextApp                                                      */
/* ------------------------------------------------------------------ */

export function StudioNextApp({ initialRoute }: StudioNextAppProps) {
  const [activeRoute, setActiveRoute] = useState<StudioNextRoute>(() => initialRoute ?? resolveStudioNextRoute());
  const [settingsSectionId, setSettingsSectionId] = useState("models");

  const navigate = useCallback((route: StudioNextRoute) => {
    setActiveRoute(route);
    if (typeof window !== "undefined" && window.history?.pushState) {
      window.history.pushState(null, "", ROUTE_PATHS[route]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setActiveRoute(resolveStudioNextRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // --- Data for sidebar ---
  const { data: booksData } = useApi<{ books: BookListItem[] }>("/books");
  const { data: sessionsData } = useApi<{ sessions: NarratorSessionRecord[] }>("/sessions?sort=recent&status=active");
  const books: BookListItem[] = booksData?.books ?? [];
  const sessions: NarratorSession[] = (sessionsData?.sessions ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    projectId: s.projectId,
    projectName: s.projectId ? books.find((b) => b.id === s.projectId)?.title : undefined,
    agentId: s.agentId,
    lastModified: s.lastModified,
  }));

  // --- Content area ---
  let content: React.ReactNode;
  switch (activeRoute) {
    case "dashboard":
      content = <DashboardPage onOpenBook={() => navigate("workspace")} />;
      break;
    case "settings":
      content = (
        <SettingsLayout title="设置" sections={SETTINGS_SECTIONS} activeSectionId={settingsSectionId} onSectionChange={setSettingsSectionId}>
          {settingsSectionId === "providers" ? <ProviderSettingsPage /> : <SettingsSectionContent sectionId={settingsSectionId} onSectionChange={setSettingsSectionId} />}
        </SettingsLayout>
      );
      break;
    case "routines":
      content = <RoutinesNextPage />;
      break;
    case "workflow":
      content = <WorkflowPage />;
      break;
    case "search":
      content = <SearchPage />;
      break;
    case "workspace":
    default:
      content = <WorkspacePage />;
      break;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 固定 sidebar — 参考 NarraFork navbar: fixed, 250px, flex-column */}
      <aside className="flex w-[250px] shrink-0 flex-col border-r border-border">
        <Sidebar
          storylineContent={
            <StorylineTree
              activeBookId={books[0]?.id ?? null}
              books={books}
              onBookChange={() => navigate("workspace")}
              onBookClick={() => navigate("workspace")}
            />
          }
          narratorContent={
            <NarratorList
              sessions={sessions}
              activeSessionId={null}
              onSessionClick={() => navigate("workspace")}
            />
          }
          narratorActions={<NarratorActions onNewSession={() => navigate("workspace")} />}
          onRoutinesClick={() => navigate("routines")}
          onSettingsClick={() => navigate("settings")}
        />
      </aside>

      {/* 全宽内容区 — 参考 NarraFork main: padding-left navbar width */}
      <main className="flex-1 overflow-hidden">
        {content}
      </main>
    </div>
  );
}
