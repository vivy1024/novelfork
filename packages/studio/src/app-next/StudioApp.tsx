/**
 * StudioApp — IDE 风格顶层布局
 *
 * 使用 SplitView 三面板替代旧的 NextShell 固定布局。
 * 左侧 Sidebar 接入真实数据，中间和右侧复用现有页面组件。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SplitView, usePanelLayout, type SplitViewHandle, type SplitViewPanel } from "@/components/split-view/SplitView";
import { useApi } from "@/hooks/use-api";
import { Sidebar } from "./sidebar/Sidebar";
import { StorylineTree, type BookListItem } from "./sidebar/StorylineTree";
import { NarratorList, NarratorActions, type NarratorSession } from "./sidebar/NarratorList";
import { WorkspacePage } from "./workspace/WorkspacePage";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsLayout } from "./components/layouts";
import { WorkflowPage } from "./workflow/WorkflowPage";
import { SearchPage } from "./search/SearchPage";
import { SessionCenterPage } from "./sessions/SessionCenterPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { User, Cpu, Bot, Bell, Palette, Plug, Server, Database, Activity, Clock, FolderCog, Info } from "lucide-react";

import type { NarratorSessionRecord } from "@/shared/session-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StudioView = "workspace" | "dashboard" | "settings" | "routines" | "workflow" | "search" | "sessions";

/* ------------------------------------------------------------------ */
/*  Settings sections (from old StudioNextApp)                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Layout defaults                                                    */
/* ------------------------------------------------------------------ */

const LAYOUT_KEY = "studio-main";
const LAYOUT_DEFAULTS = {
  widths: { sidebar: 220, editor: 600, conversation: 400 },
  collapsed: { sidebar: false, editor: false, conversation: false },
} as const;

/* ------------------------------------------------------------------ */
/*  StudioApp                                                          */
/* ------------------------------------------------------------------ */

export function StudioApp() {
  const splitRef = useRef<SplitViewHandle>(null);
  const { layout } = usePanelLayout(LAYOUT_KEY, LAYOUT_DEFAULTS);
  const [activeView, setActiveView] = useState<StudioView>("workspace");
  const [settingsSectionId, setSettingsSectionId] = useState("models");

  // --- Data fetching ---
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

  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Auto-select first book
  useEffect(() => {
    if (!activeBookId && books.length > 0) {
      setActiveBookId(books[0]!.id);
    }
  }, [activeBookId, books]);

  // --- Sidebar content ---
  const sidebarContent = (
    <Sidebar
      storylineContent={
        <StorylineTree
          activeBookId={activeBookId}
          books={books}
          onBookChange={setActiveBookId}
          onBookClick={() => setActiveView("workspace")}
        />
      }
      narratorContent={
        <NarratorList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionClick={(id) => {
            setActiveSessionId(id);
            setActiveView("workspace");
          }}
        />
      }
      narratorActions={<NarratorActions onNewSession={() => setActiveView("sessions")} />}
      onRoutinesClick={() => setActiveView("routines")}
      onSettingsClick={() => setActiveView("settings")}
    />
  );

  // --- Center content (based on active view) ---
  const centerContent = useMemo(() => {
    switch (activeView) {
      case "workspace":
        return <WorkspacePage />;
      case "dashboard":
        return <DashboardPage onOpenBook={() => setActiveView("workspace")} />;
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
  }, [activeView, settingsSectionId]);

  // --- Panels ---
  const panels: SplitViewPanel[] = useMemo(
    () => [
      {
        id: "sidebar",
        content: sidebarContent,
        defaultWidth: LAYOUT_DEFAULTS.widths.sidebar,
        minWidth: 180,
        collapsible: true,
        collapsed: layout.collapsed.sidebar,
      },
      {
        id: "editor",
        content: <div className="h-full overflow-auto">{centerContent}</div>,
        defaultWidth: LAYOUT_DEFAULTS.widths.editor,
        minWidth: 200,
      },
      {
        id: "conversation",
        content: <div className="h-full overflow-hidden bg-card p-0 text-xs text-muted-foreground flex items-center justify-center">对话面板（从工作台右侧叙述者迁移中）</div>,
        defaultWidth: LAYOUT_DEFAULTS.widths.conversation,
        minWidth: 320,
        collapsible: true,
        collapsed: layout.collapsed.conversation,
      },
    ],
    [layout.collapsed.sidebar, layout.collapsed.conversation, sidebarContent, centerContent],
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
      case "1":
        e.preventDefault();
        focusPanel("sidebar");
        break;
      case "2":
        e.preventDefault();
        focusPanel("editor");
        break;
      case "3":
        e.preventDefault();
        focusPanel("conversation");
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div data-testid="studio-app" className="h-screen w-screen bg-background text-foreground">
      <SplitView ref={splitRef} panels={panels} className="h-full w-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function focusPanel(panelId: string): void {
  const el = document.querySelector(`[data-testid="split-panel-${panelId}"]`);
  if (el instanceof HTMLElement) {
    const focusable = el.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? el).focus();
  }
}
