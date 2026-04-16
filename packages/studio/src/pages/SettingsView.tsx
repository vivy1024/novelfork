import { useState } from "react";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { Settings, User, Palette, Code, Keyboard, Bell, Activity, Info, Database } from "lucide-react";
import { ProfilePanel } from "./settings/ProfilePanel";
import { AppearancePanel } from "./settings/AppearancePanel";
import { EditorPanel } from "./settings/EditorPanel";
import { MonitoringPanel } from "./settings/MonitoringPanel";
import { DataPanel } from "./settings/DataPanel";

interface Props {
  nav: any;
  theme: Theme;
  t: TFunction;
  onThemeChange?: (theme: "light" | "dark" | "auto") => void;
}

type SettingsSection = "profile" | "appearance" | "editor" | "shortcuts" | "notifications" | "monitoring" | "data" | "about";

export function SettingsView({ nav, theme, t, onThemeChange }: Props) {
  const c = useColors(theme);
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");

  const sections: Array<{ id: SettingsSection; label: string; icon: any }> = [
    { id: "profile", label: "个人资料", icon: User },
    { id: "appearance", label: "外观", icon: Palette },
    { id: "editor", label: "编辑器", icon: Code },
    { id: "shortcuts", label: "快捷键", icon: Keyboard },
    { id: "notifications", label: "通知", icon: Bell },
    { id: "monitoring", label: "系统监控", icon: Activity },
    { id: "data", label: "数据管理", icon: Database },
    { id: "about", label: "关于", icon: Info },
  ];

  return (
    <div className="flex h-screen">
      {/* 侧边栏导航 */}
      <div className="w-64 border-r border-border bg-background p-4">
        <div className="flex items-center gap-2 mb-6">
          <Settings className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">设置</h1>
        </div>
        <nav className="space-y-1">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {section.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl">
          {activeSection === "profile" && <ProfilePanel theme={theme} />}
          {activeSection === "appearance" && (
            <AppearancePanel
              theme={theme}
              onThemeChange={onThemeChange || (() => {})}
            />
          )}
          {activeSection === "editor" && <EditorPanel theme={theme} />}
          {activeSection === "shortcuts" && (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-foreground">快捷键</h2>
              <p className="text-muted-foreground">快捷键配置面板开发中...</p>
            </div>
          )}
          {activeSection === "notifications" && (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-foreground">通知</h2>
              <p className="text-muted-foreground">通知设置面板开发中...</p>
            </div>
          )}
          {activeSection === "monitoring" && <MonitoringPanel theme={theme} />}
          {activeSection === "data" && <DataPanel theme={theme} />}
          {activeSection === "about" && (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-foreground">关于</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">应用名称</p>
                  <p className="text-foreground font-medium">InkOS Studio</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">版本</p>
                  <p className="text-foreground font-medium">v2.0.0</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">描述</p>
                  <p className="text-foreground">AI 驱动的小说创作工作台</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
