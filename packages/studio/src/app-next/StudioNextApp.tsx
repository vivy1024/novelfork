import { useCallback, useEffect, useState } from "react";

import { resolveStudioNextRoute, STUDIO_NEXT_BASE_PATH, type StudioNextRoute } from "./entry";
import { NextShell, SettingsLayout } from "./components/layouts";
import { DashboardPage } from "./dashboard/DashboardPage";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { WorkspacePage } from "./workspace/WorkspacePage";
import { WorkflowPage } from "./workflow/WorkflowPage";
import { SearchPage } from "./search/SearchPage";
import { User, Cpu, Bot, Bell, Palette, Plug, Server, Database, Activity, Clock, FolderCog, Info } from "lucide-react";

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

export function StudioNextApp({ initialRoute }: StudioNextAppProps) {
  const [activeRoute, setActiveRoute] = useState<StudioNextRoute>(() => initialRoute ?? resolveStudioNextRoute());

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

  return (
    <NextShell activeRoute={activeRoute} onRouteChange={navigate}>
      {activeRoute === "dashboard" && <DashboardPage onOpenBook={() => navigate("workspace")} />}
      {activeRoute === "workspace" && <WorkspacePage />}
      {activeRoute === "settings" && <SettingsPage />}
      {activeRoute === "routines" && <RoutinesPage />}
      {activeRoute === "workflow" && <WorkflowPage />}
      {activeRoute === "search" && <SearchPage />}
    </NextShell>
  );
}

function SettingsPage() {
  const [sectionId, setSectionId] = useState("models");

  return (
    <SettingsLayout title="设置" sections={SETTINGS_SECTIONS} activeSectionId={sectionId} onSectionChange={setSectionId}>
      {sectionId === "providers" ? (
        <ProviderSettingsPage />
      ) : (
        <SettingsSectionContent sectionId={sectionId} onSectionChange={setSectionId} />
      )}
    </SettingsLayout>
  );
}

function RoutinesPage() {
  return <RoutinesNextPage />;
}
