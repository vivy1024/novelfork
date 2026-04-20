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

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
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

interface Props {
  nav: unknown;
  theme: Theme;
  t: TFunction;
  onThemeChange?: (theme: "light" | "dark" | "auto") => void;
  section?: SettingsSection;
  onNavigateSection?: (section: SettingsSection) => void;
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; description: string; icon: typeof User }> = [
  { id: "profile", label: "个人资料", description: "姓名、邮箱与 Git 信息", icon: User },
  { id: "appearance", label: "外观", description: "主题、色彩和显示模式", icon: Palette },
  { id: "editor", label: "编辑器", description: "字体、行高和自动保存", icon: Code },
  { id: "shortcuts", label: "快捷键", description: "常用操作的快捷入口", icon: Keyboard },
  { id: "notifications", label: "通知", description: "Webhook 和消息提醒", icon: Bell },
  { id: "monitoring", label: "系统监控", description: "资源快照和运行状态", icon: Activity },
  { id: "data", label: "数据管理", description: "导入、导出与备份", icon: Database },
  { id: "advanced", label: "高级设置", description: "更细粒度的运行参数", icon: Sliders },
  { id: "about", label: "关于", description: "版本与应用信息", icon: Info },
];

export function SettingsView({
  nav,
  theme,
  t,
  onThemeChange,
  section,
  onNavigateSection,
}: Props) {
  void nav;
  void t;

  const [activeSection, setActiveSection] = useState<SettingsSection>(section ?? "profile");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  useEffect(() => {
    setActiveSection(section ?? "profile");
  }, [section]);

  const activeItem = SETTINGS_SECTIONS.find((item) => item.id === activeSection) ?? SETTINGS_SECTIONS[0];

  const selectSection = (nextSection: SettingsSection) => {
    setActiveSection(nextSection);
    onNavigateSection?.(nextSection);
  };

  return (
    <>
      <PageScaffold
        title="设置"
        description="把外观、编辑器、数据与运行参数统一收口到一个设置中心，逐步向 NarraFork 的平台设置结构靠拢。"
        actions={activeSection === "advanced" ? (
          <Button variant="outline" onClick={() => setShowAdvancedSettings(true)}>
            打开高级设置窗口
          </Button>
        ) : (
          <Badge variant="secondary">本地配置</Badge>
        )}
      >
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]" data-testid="settings-form">
          <Card className="h-fit">
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
                  <Button
                    key={item.id}
                    type="button"
                    variant={isActive ? "secondary" : "ghost"}
                    onClick={() => selectSection(item.id)}
                    className="w-full justify-start gap-3"
                  >
                    <Icon className="size-4" />
                    <span className="flex min-w-0 flex-1 flex-col items-start text-left">
                      <span className="text-sm font-medium">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    </span>
                    {isActive && <Badge variant="outline">当前</Badge>}
                  </Button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <activeItem.icon className="size-5 text-primary" />
                {activeItem.label}
              </CardTitle>
              <CardDescription>{activeItem.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeSection === "profile" && <ProfilePanel theme={theme} />}
              {activeSection === "appearance" && (
                <AppearancePanel theme={theme} onThemeChange={onThemeChange || (() => {})} />
              )}
              {activeSection === "editor" && <EditorPanel theme={theme} />}
              {activeSection === "shortcuts" && (
                <PlaceholderSection
                  title="快捷键"
                  description="命令面板、保存、导航等快捷键说明会在这里统一收口。"
                />
              )}
              {activeSection === "notifications" && (
                <PlaceholderSection
                  title="通知"
                  description="Webhook、Telegram 和飞书等通知入口会在后续批次回到这里。"
                />
              )}
              {activeSection === "monitoring" && <MonitoringPanel theme={theme} />}
              {activeSection === "data" && <DataPanel theme={theme} />}
              {activeSection === "advanced" && (
                <PlaceholderSection
                  title="高级设置"
                  description="高级运行参数仍然沿用现有弹窗窗口，先在这里收口，后续再并回页内配置。"
                  action={
                    <Button variant="outline" onClick={() => setShowAdvancedSettings(true)}>
                      打开高级设置
                    </Button>
                  }
                />
              )}
              {activeSection === "about" && (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <InfoBlock label="应用名称" value="NovelFork Studio" />
                    <InfoBlock label="版本" value="v2.0.0" />
                    <InfoBlock label="模式" value="本地优先" />
                  </div>
                  <Card size="sm" className="border-dashed bg-muted/20">
                    <CardContent className="space-y-2 py-6 text-sm text-muted-foreground">
                      <p>AI 驱动的小说创作工作台。</p>
                      <p>当前设置页仍在持续向 NarraFork 的平台设置结构靠拢。</p>
                    </CardContent>
                  </Card>
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
  return <PageEmptyState title={title} description={description} action={action} />;
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
