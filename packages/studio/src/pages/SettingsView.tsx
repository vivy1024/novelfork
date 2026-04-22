import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  Code,
  Database,
  Info,
  Keyboard,
  Palette,
  Settings as SettingsIcon,
  Sliders,
  User,
} from "lucide-react";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "../components/Settings";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";
import type { SettingsSection } from "../routes";
import { AppearancePanel } from "./settings/AppearancePanel";
import { DataPanel } from "./settings/DataPanel";
import { EditorPanel } from "./settings/EditorPanel";
import { MonitoringPanel } from "./settings/MonitoringPanel";
import { ProfilePanel } from "./settings/ProfilePanel";
import { RuntimeControlPanel } from "./settings/RuntimeControlPanel";

interface Props {
  nav: unknown;
  theme: Theme;
  t: TFunction;
  onThemeChange?: (theme: "light" | "dark" | "auto") => void;
  section?: SettingsSection;
  onNavigateSection?: (section: SettingsSection) => void;
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof User }> = [
  { id: "profile", label: "个人资料", icon: User },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "editor", label: "编辑器", icon: Code },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "monitoring", label: "系统监控", icon: Activity },
  { id: "data", label: "数据管理", icon: Database },
  { id: "advanced", label: "高级设置", icon: Sliders },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsView({
  nav,
  theme,
  t,
  onThemeChange,
  section,
  onNavigateSection,
}: Props) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(section ?? "profile");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  useEffect(() => {
    setActiveSection(section ?? "profile");
  }, [section]);

  const selectSection = (nextSection: SettingsSection) => {
    setActiveSection(nextSection);
    onNavigateSection?.(nextSection);
  };

  return (
    <>
      <PageScaffold
        title="设置"
        description="把外观、编辑器、数据与运行参数统一收口到一个设置中心，逐步向 NarraFork 的平台设置结构靠拢。"
        actions={
          activeSection === "advanced" ? (
            <Button variant="outline" onClick={() => setShowAdvancedSettings(true)}>
              打开高级设置窗口
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]" data-testid="settings-form">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="size-5 text-primary" />
                设置导航
              </CardTitle>
              <CardDescription>先统一信息架构，再逐步并回旧弹窗式高级配置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {SETTINGS_SECTIONS.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectSection(item.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "border-border bg-muted/80 font-semibold text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{SETTINGS_SECTIONS.find((item) => item.id === activeSection)?.label ?? "设置"}</CardTitle>
            </CardHeader>
            <CardContent>
              {activeSection === "profile" && <ProfilePanel theme={theme} />}
              {activeSection === "appearance" && (
                <AppearancePanel theme={theme} onThemeChange={onThemeChange || (() => {})} />
              )}
              {activeSection === "editor" && <EditorPanel theme={theme} />}
              {activeSection === "shortcuts" && (
                <PlaceholderSection title="快捷键" description="下一批会把命令面板、参考面板、保存等快捷键说明统一搬到这里。" />
              )}
              {activeSection === "notifications" && (
                <PlaceholderSection title="通知" description="后续会把 Webhook、Telegram、飞书等通知能力并回统一设置页。" />
              )}
              {activeSection === "monitoring" && <MonitoringPanel theme={theme} />}
              {activeSection === "data" && <DataPanel theme={theme} />}
              {activeSection === "advanced" && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">高级设置</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      运行控制正式并入设置页内结构；旧高级设置弹窗保留在页头，便于对照剩余配置。
                    </p>
                  </div>
                  <RuntimeControlPanel />
                </div>
              )}
              {activeSection === "about" && (
                <div className="space-y-4">
                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">应用名称</p>
                    <p className="font-medium text-foreground">NovelFork Studio</p>
                  </div>
                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">版本</p>
                    <p className="font-medium text-foreground">v2.0.0</p>
                  </div>
                  <div>
                    <p className="mb-1 text-sm text-muted-foreground">描述</p>
                    <p className="text-foreground">AI 驱动的小说创作工作台</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageScaffold>

      {showAdvancedSettings && <Settings onClose={() => setShowAdvancedSettings(false)} theme={theme} />}
    </>
  );
}

function PlaceholderSection({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
