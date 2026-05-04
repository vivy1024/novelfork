/**
 * StudioNextApp — 顶层入口
 *
 * 使用 SplitView IDE 布局替代旧的 NextShell 固定三栏。
 * 左侧 Sidebar（叙事线/叙述者/套路/设置），中间内容区（路由页面），右侧对话面板暂留占位。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveStudioNextRoute, STUDIO_NEXT_BASE_PATH, type StudioNextRoute } from "./entry";
import { SplitView, usePanelLayout, type SplitViewHandle, type SplitViewPanel } from "@/components/split-view/SplitView";
import { useApi } from "@/hooks/use-api";
import { Sidebar } from "./sidebar/Sidebar";
import { StorylineTree, type BookListItem } from "./sidebar/StorylineTree";
import { NarratorList, NarratorActions, type NarratorSession } from "./sidebar/NarratorList";
import { DashboardPage } from "./dashboard/DashboardPage";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { SettingsLayout } from "./components/layouts";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { WorkspacePage } from "./workspace/WorkspacePage";
import { WorkflowPage } from "./workflow/WorkflowPage";
import { SearchPage } from "./search/SearchPage";
import { SessionCenterPage } from "./sessions/SessionCenterPage";
import { User, Cpu, Bot, Bell, Palette, Plug, Server, Database, Activity, Clock, FolderCog, Info } from "lucide-react";

import type { NarratorSessionRecord } from "@/shared/session-types";

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
  sessions: `${STUDIO_NEXT_BASE_PATH}/sessions`,
  studio: `${STUDIO_NEXT_BASE_PATH}/studio`,
};

const LAYOUT_KEY = "studio-main";
const LAYOUT_DEFAULTS = {
  widths: { sidebar: 220, content: 0, conversation: 0 },
  collapsed: { sidebar: false, content: false, conversation: true },
} as const;

/* ------------------------------------------------------------------ */
/*  StudioNextApp                                                      */
/* ------------------------------------------------------------------ */

export function StudioNextApp({ initialRoute }: StudioNextAppProps) {
  const splitRef = useRef<SplitViewHandle>(null);
  const { layout } = usePanelLayout(LAYOUT_KEY, LAYOUT_DEFAULTS);

  const [activeRoute, setActiveRoute] = useState<StudioNextRoute>(() => initialRoute ?? resolveStudioNextRoute());
  const [settingsSectionId, setSettingsSectionId] = useState("models");

  // --- Routing ---
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

  // --- Data ---
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

  // --- Center content ---
  const centerContent = useMemo(() => {
    switch (activeRoute) {
      case "workspace":
        return <WorkspacePage />;
      case "dashboard":
        return <DashboardPage onOpenBook={() => navigate("workspace")} />;
      case "settings":
        return (
          <SettingsLayout title="设置" sections={SETTINGS_SECTIONS} activeSectionId={settingsSectionId} onSectionChange={setSettingsSectionId}>
            {settingsSectionId === "providers" ? <ProviderSettingsPage /> : <SettingsSectionContent sectionId={settingsSectionId} onSectionChange={setSettingsSectionId} />}
          </SettingsLayout>
        );
      case "routines":
        return <RoutinesNextPage />;
      case "workflow":
        return <WorkflowPage />;
      case "search":
        return <SearchPage />;
      case "sessions":
        return <SessionCenterPage />;
      default:
        return <WorkspacePage />;
    }
  }, [activeRoute, settingsSectionId, navigate]);

  // --- Panels ---
  const panels: SplitViewPanel[] = useMemo(
    () => [
      {
        id: "sidebar",
        content: (
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
            narratorActions={<NarratorActions onNewSession={() => navigate("sessions")} />}
            onRoutinesClick={() => navigate("routines")}
            onSettingsClick={() => navigate("settings")}
          />
        ),
        defaultWidth: 220,
        minWidth: 180,
        collapsible: true,
        collapsed: layout.collapsed.sidebar,
      },
      {
        id: "content",
        content: <div className="h-full overflow-auto p-3">{centerContent}</div>,
        defaultWidth: 0,
        minWidth: 200,
      },
    ],
    [layout.collapsed.sidebar, books, sessions, centerContent, navigate],
  );

  // --- Keyboard shortcuts ---
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    if (e.key.toLowerCase() === "b") {
      e.preventDefault();
      splitRef.current?.toggleCollapse("sidebar");
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="h-screen w-screen bg-background text-foreground">
      <SplitView ref={splitRef} panels={panels} className="h-full w-full" />
    </div>
  );
}
