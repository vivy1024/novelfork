import { Suspense, lazy, useEffect, useState } from "react";
import { Activity, BarChart3, Server, SlidersHorizontal, X } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Tab = "status" | "config" | "providers" | "usage";

interface SettingsProps {
  onClose: () => void;
  theme: "light" | "dark";
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

export function Settings({ onClose, theme }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("config");

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
      <DialogContent className="max-w-5xl p-0 overflow-hidden" showCloseButton={false}>
        <div className="flex h-[720px] flex-col">
          <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b px-6 py-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl">设置</DialogTitle>
              <DialogDescription>
                把状态、配置、供应商和使用统计收口到一个统一窗口。
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
              <X className="size-4" />
            </Button>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as Tab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b px-6 pt-4">
              <TabsList variant="line" className="w-full justify-start gap-2 bg-transparent p-0">
                {SETTINGS_TABS.map((tab) => {
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

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
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
                {activeTab === "config" && <Config theme={theme} />}
                {activeTab === "providers" && <ProviderConfig theme={theme} />}
                {activeTab === "usage" && <Usage theme={theme} />}
              </Suspense>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
