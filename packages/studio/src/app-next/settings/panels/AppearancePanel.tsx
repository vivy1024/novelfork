import { useState, useEffect } from "react";
import { fetchJson, putApi } from "../../../hooks/use-api";
import { DEFAULT_USER_CONFIG, type UserPreferences } from "../../../types/settings";
import { Sun, Moon, Monitor, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";

function SwitchRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function AppearancePanel() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_CONFIG.preferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson<{ preferences: UserPreferences }>("/settings/user")
      .then((data) => {
        setPreferences({ ...DEFAULT_USER_CONFIG.preferences, ...data.preferences });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async (patch: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    setSaving(true);
    try {
      await putApi("/settings/user", { preferences: patch });
    } finally {
      setSaving(false);
    }
  };

  async function handleThemeChange(newTheme: "light" | "dark" | "auto") {
    setPreferences((prev) => ({ ...prev, theme: newTheme }));
    setSaving(true);
    try {
      await putApi("/settings/theme", { theme: newTheme });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  const themeOptions = [
    { value: "light" as const, icon: Sun, label: "浅色" },
    { value: "dark" as const, icon: Moon, label: "深色" },
    { value: "auto" as const, icon: Monitor, label: "跟随系统" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">外观</h2>
        <p className="text-sm text-muted-foreground">
          自定义应用的外观和主题
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-6">
        {/* 主题选择 */}
        <div>
          <label className="text-sm font-medium mb-3 block text-foreground">
            主题模式
          </label>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map(({ value, icon: Icon, label }) => (
              <Button
                key={value}
                variant="outline"
                onClick={() => handleThemeChange(value)}
                className={`flex flex-col items-center gap-2 p-4 h-auto rounded-lg border-2 transition-colors ${
                  preferences.theme === value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-sm font-medium">{label}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* 字体大小 */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-3 text-foreground">
            <Type className="w-4 h-4" />
            字体大小
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="12"
              max="20"
              value={preferences.fontSize}
              onChange={(e) => save({ fontSize: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="text-sm font-mono text-muted-foreground w-12 text-right">
              {preferences.fontSize}px
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            调整界面文字大小（12-20px）
          </p>
        </div>

        {/* 字体族 */}
        <div>
          <label className="text-sm font-medium mb-2 block text-foreground">
            字体族
          </label>
          <SimpleSelect
            value={preferences.fontFamily}
            onValueChange={(v) => save({ fontFamily: v })}
            aria-label="字体族"
            options={[
              { value: "system-ui, -apple-system, sans-serif", label: "系统默认" },
              { value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", label: "Segoe UI" },
              { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: "Helvetica" },
              { value: "'PingFang SC', 'Microsoft YaHei', sans-serif", label: "苹方 / 微软雅黑" },
            ]}
          />
        </div>

        {/* 显示 */}
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold mb-3">显示</h3>
          <div className="space-y-3">
            <SwitchRow
              label="高级动画"
              description="为消息和卡片启用 blur-in 动画"
              checked={preferences.advancedAnimations}
              onChange={(v) => save({ advancedAnimations: v })}
            />
          </div>
        </div>

        {/* 自动换行 */}
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold mb-3">自动换行</h3>
          <div className="space-y-3">
            <SwitchRow
              label="Markdown"
              checked={preferences.wrapMarkdown}
              onChange={(v) => save({ wrapMarkdown: v })}
            />
            <SwitchRow
              label="代码"
              checked={preferences.wrapCode}
              onChange={(v) => save({ wrapCode: v })}
            />
            <SwitchRow
              label="Diff"
              checked={preferences.wrapDiff}
              onChange={(v) => save({ wrapDiff: v })}
            />
          </div>
        </div>

        {/* 语言 */}
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold mb-3">语言</h3>
          <SimpleSelect
            value={preferences.language}
            onValueChange={(v) => save({ language: v })}
            aria-label="语言"
            options={[
              { value: "zh", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
          />
        </div>

        {saving && (
          <div className="text-xs text-muted-foreground">
            保存中...
          </div>
        )}
      </div>
    </div>
  );
}
