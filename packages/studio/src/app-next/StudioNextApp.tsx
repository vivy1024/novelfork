/**
 * StudioNextApp — 顶层入口
 *
 * 对标 Claude Code REPL.tsx 的数据中心模式：
 * 顶层持有所有数据，通过 props 分发给 Sidebar / EditorArea / ConversationPanel。
 *
 * 当前阶段：Sidebar 接入真实资源树，中间面板复用 WorkspacePage（含编辑器+AI面板），
 * 右侧面板独立渲染 NarratorPanel（从 WorkspacePage 提取）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveStudioNextRoute, STUDIO_NEXT_BASE_PATH, type StudioNextRoute } from "./entry";
import { SplitView, usePanelLayout, type SplitViewHandle, type SplitViewPanel } from "@/components/split-view/SplitView";
import { Sidebar } from "./sidebar/Sidebar";
import { StorylineTree } from "./sidebar/StorylineTree";
import { NarratorList, NarratorActions, type NarratorSession } from "./sidebar/NarratorList";
import { useStudioData } from "./hooks/useStudioData";

// 页面组件
import { DashboardPage } from "./dashboard/DashboardPage";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { SettingsLayout } from "./components/layouts";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { WorkspacePage } from "./workspace/WorkspacePage";
import { WorkflowPage } from "./workflow/WorkflowPage";
import { SearchPage } from "./search/SearchPage";
import { SessionCenterPage } from "./sessions/SessionCenterPage";
import { NarratorPanel } from "../components/ChatWindow";
import { SessionCenter } from "../components/sessions/SessionCenter";
import { Button } from "../components/ui/button";
import { useWindowStore } from "../stores/windowStore";
import { User, Cpu, Bot, Bell, Palette, Plug, Server, Database, Activity, Clock, FolderCog, Info } from "lucide-react";

import type { NarratorSessionRecord } from "@/shared/session-types";
import type { CanvasContext } from "@/shared/agent-native-workspace";

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
  widths: { sidebar: 220, content: 700, conversation: 380 },
  collapsed: { sidebar: false, content: false, conversation: false },
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
  const studioData = useStudioData();
  const { books, activeBookId, setActiveBookId, resourceNodes, sessions, activeSessionId, setActiveSessionId } = studioData;

  const narratorSessions: NarratorSession[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    projectId: s.projectId,
    projectName: s.projectId ? books.find((b) => b.id === s.projectId)?.title : undefined,
    agentId: s.agentId,
    lastModified: s.lastModified,
  }));

  // --- Center content ---
  const isWorkspace = activeRoute === "workspace" || activeRoute === "studio";

  const centerContent = useMemo(() => {
    switch (activeRoute) {
      case "workspace":
      case "studio":
        return <WorkspacePage hideNarrator />;
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
                activeBookId={activeBookId}
                books={books}
                onBookChange={(id) => {
                  setActiveBookId(id);
                  navigate("workspace");
                }}
                onBookClick={() => navigate("workspace")}
              />
            }
            narratorContent={
              <NarratorList
                sessions={narratorSessions}
                activeSessionId={activeSessionId}
                onSessionClick={(id) => {
                  setActiveSessionId(id);
                  navigate("workspace");
                }}
              />
            }
            narratorActions={<NarratorActions onNewSession={() => navigate("sessions")} />}
            onRoutinesClick={() => navigate("routines")}
            onSettingsClick={() => navigate("settings")}
          />
        ),
        defaultWidth: LAYOUT_DEFAULTS.widths.sidebar,
        minWidth: 180,
        collapsible: true,
        collapsed: layout.collapsed.sidebar,
      },
      {
        id: "content",
        content: (
          <div className="h-full overflow-hidden">
            {centerContent}
          </div>
        ),
        defaultWidth: LAYOUT_DEFAULTS.widths.content,
        minWidth: 400,
      },
      {
        id: "conversation",
        content: (
          <div className="flex h-full flex-col overflow-hidden bg-card">
            <RightPanelContent isWorkspace={isWorkspace} />
          </div>
        ),
        defaultWidth: LAYOUT_DEFAULTS.widths.conversation,
        minWidth: 300,
        collapsible: true,
        collapsed: layout.collapsed.conversation,
      },
    ],
    [layout.collapsed.sidebar, layout.collapsed.conversation, books, activeBookId, narratorSessions, activeSessionId, centerContent, isWorkspace, navigate, setActiveBookId, setActiveSessionId],
  );

  // --- Keyboard shortcuts ---
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    switch (e.key.toLowerCase()) {
      case "b":
        e.preventDefault();
        splitRef.current?.toggleCollapse("sidebar");
        break;
      case "j":
        e.preventDefault();
        splitRef.current?.toggleCollapse("conversation");
        break;
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

/* ------------------------------------------------------------------ */
/*  Right panel — NarratorPanel (extracted from WorkspacePage)          */
/* ------------------------------------------------------------------ */

function RightPanelContent({ isWorkspace }: { readonly isWorkspace: boolean }) {
  const windows = useWindowStore((s) => s.windows);
  const addWindow = useWindowStore((s) => s.addWindow);
  const updateWindow = useWindowStore((s) => s.updateWindow);
  const setActiveWindow = useWindowStore((s) => s.setActiveWindow);
  const [showSessionCenter, setShowSessionCenter] = useState(false);

  // Find or create a narrator window
  const windowId = useMemo(() => {
    const existing = windows.find((w) => w.agentId === "writer" && w.sessionMode === "chat");
    if (existing) return existing.id;
    return null;
  }, [windows]);

  // Create window if none exists
  const [createdWindowId, setCreatedWindowId] = useState<string | null>(null);
  useEffect(() => {
    if (windowId || createdWindowId) return;
    const id = addWindow({
      title: "叙述者",
      agentId: "writer",
      sessionMode: "chat",
    });
    setCreatedWindowId(id);
  }, [windowId, createdWindowId, addWindow]);

  const effectiveWindowId = windowId ?? createdWindowId;

  const openSession = useCallback((session: NarratorSessionRecord) => {
    if (!effectiveWindowId) return;
    updateWindow(effectiveWindowId, {
      title: session.title,
      agentId: session.agentId,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      minimized: false,
    });
    setActiveWindow(effectiveWindowId);
    setShowSessionCenter(false);
  }, [setActiveWindow, updateWindow, effectiveWindowId]);

  if (!isWorkspace) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        在工作台模式下使用叙述者对话。
      </div>
    );
  }

  if (!effectiveWindowId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        正在准备叙述者会话…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">叙述者</div>
        <Button type="button" size="xs" variant="outline" onClick={() => setShowSessionCenter((v) => !v)}>
          {showSessionCenter ? "返回叙述者" : "会话中心"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {showSessionCenter ? (
          <SessionCenter className="p-3" onOpenSession={openSession} />
        ) : (
          <NarratorPanel windowId={effectiveWindowId} theme="light" />
        )}
      </div>
    </div>
  );
}
