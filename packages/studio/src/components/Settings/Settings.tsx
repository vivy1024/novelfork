import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Server, SlidersHorizontal, X } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsSection } from "../../routes";

type Tab = "status" | "config" | "providers" | "usage";

type SettingsTheme = "light" | "dark";

interface SettingsProps {
  onClose: () => void;
  theme: SettingsTheme;
}

interface SettingsContentProps {
  theme: SettingsTheme;
  variant?: "dialog" | "embedded";
  tabs?: ReadonlyArray<Tab>;
  defaultTab?: Tab;
  onNavigateSection?: (section: SettingsSection) => void;
}

const SETTINGS_TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "status", label: "状态", icon: Activity },
  { id: "config", label: "配置", icon: SlidersHorizontal },
  { id: "providers", label: "供应商", icon: Server },
  { id: "usage", label: "使用统计", icon: BarChart3 },
];

const Config = lazy(() => import("./Config").then((m) => ({ default: m.Config })));
const Status = lazy(() => import("./Status").then((m) => ({ default: m.Status })));
const Usage = lazy(() => import("./Usage").then((m) => ({ default: m.Usage })));
const ProviderConfig = lazy(() => import("../Model/ProviderConfig").then((m) => ({ default: m.ProviderConfig })));

export function SettingsContent({
  theme,
  variant = "dialog",
  tabs,
  defaultTab = "config",
  onNavigateSection,
}: SettingsContentProps) {
  const availableTabs = useMemo(() => {
    if (!tabs?.length) {
      return SETTINGS_TABS;
    }

    const allowedTabs = new Set(tabs);
    return SETTINGS_TABS.filter((tab) => allowedTabs.has(tab.id));
  }, [tabs]);

  const resolvedDefaultTab = availableTabs.find((tab) => tab.id === defaultTab)?.id ?? availableTabs[0]?.id ?? "config";
  const [activeTab, setActiveTab] = useState<Tab>(resolvedDefaultTab);

  useEffect(() => {
    setActiveTab(resolvedDefaultTab);
  }, [resolvedDefaultTab]);

  const tabsContainerClassName = variant === "dialog"
    ? "border-b px-6 pt-4"
    : "border-b pb-2";

  const contentClassName = variant === "dialog"
    ? "min-h-0 flex-1 overflow-y-auto p-6"
    : "pt-4";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as Tab)}
      className={variant === "dialog" ? "flex min-h-0 flex-1 flex-col" : "space-y-0"}
    >
      <div className={tabsContainerClassName}>
        <TabsList
          variant="line"
          className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0"
        >
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-2 rounded-none px-1.5 py-2">
                <Icon className="size-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      <div className={contentClassName}>
        <Suspense
          fallback={
            <PageEmptyState
              title="正在加载设置"
              description="设置内容正在准备中，请稍候。"
              icon={Activity}
            />
          }
        >
          {activeTab === "status" && <Status theme={theme} />}
          {activeTab === "config" && (
            <Config theme={theme} onNavigateSection={onNavigateSection} variant={variant} />
          )}
          {activeTab === "providers" && <ProviderConfig theme={theme} />}
          {activeTab === "usage" && <Usage theme={theme} />}
        </Suspense>
      </div>
    </Tabs>
  );
}

export function Settings({ onClose, theme }: SettingsProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-5xl overflow-hidden p-0" showCloseButton={false}>
        <div className="flex h-[720px] flex-col">
          <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b px-6 py-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl">设置</DialogTitle>
              <DialogDescription>
                兼容窗口只承接剩余能力；设置页才是当前主入口与主事实源。
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
              <X className="size-4" />
            </Button>
          </DialogHeader>

          <SettingsContent theme={theme} variant="dialog" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
