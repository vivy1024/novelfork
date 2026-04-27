import { useCallback, useEffect, useState } from "react";

import { resolveStudioNextRoute, STUDIO_NEXT_BASE_PATH, type StudioNextRoute } from "./entry";
import { NextShell, SectionLayout, SettingsLayout } from "./components/layouts";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { WorkspacePage } from "./workspace/WorkspacePage";

interface StudioNextAppProps {
  readonly initialRoute?: StudioNextRoute;
}

const SETTINGS_SECTIONS = [
  { id: "profile", label: "个人资料", status: "可编辑", group: "个人设置" },
  { id: "models", label: "模型", status: "部分接入", group: "个人设置" },
  { id: "agents", label: "AI 代理", status: "复用运行时", group: "个人设置" },
  { id: "notifications", label: "通知", status: "未接入", group: "个人设置" },
  { id: "appearance", label: "外观与界面", status: "可迁移", group: "个人设置" },
  { id: "providers", label: "AI 供应商", status: "可管理", group: "实例管理" },
  { id: "server", label: "服务器与系统", status: "只读", group: "实例管理" },
  { id: "storage", label: "存储空间", status: "只读", group: "实例管理" },
  { id: "resources", label: "运行资源", status: "只读", group: "实例管理" },
  { id: "history", label: "使用历史", status: "可查看", group: "实例管理" },
  { id: "about", label: "关于", status: "可查看", group: "实例管理" },
] as const;

const ROUTE_PATHS: Record<StudioNextRoute, string> = {
  workspace: STUDIO_NEXT_BASE_PATH,
  settings: `${STUDIO_NEXT_BASE_PATH}/settings`,
  routines: `${STUDIO_NEXT_BASE_PATH}/routines`,
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
    <NextShell activeRoute={activeRoute} onRouteChange={navigate} status="旧前端冻结，旁路建设中">
      {activeRoute === "workspace" && <WorkspacePage />}
      {activeRoute === "settings" && <SettingsPage />}
      {activeRoute === "routines" && <RoutinesPage />}
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
  return (
    <SectionLayout title="套路" description="复用旧 Routines API 与类型。">
      <RoutinesNextPage />
    </SectionLayout>
  );
}
