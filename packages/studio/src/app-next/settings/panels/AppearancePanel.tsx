import { useState, useEffect } from "react";
import { fetchJson, putApi } from "../../../hooks/use-api";
import { DEFAULT_USER_CONFIG, type UserPreferences } from "../../../types/settings";
import { Sun, Moon, Monitor, Type } from "lucide-react";

export function AppearancePanel() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_CONFIG.preferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson<{ preferences: UserPreferences }>("/settings/user")
      .then((data) => {
        setPreferences(data.preferences);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleThemeChange(newTheme: "light" | "dark" | "auto") {
    setPreferences({ ...preferences, theme: newTheme });
    setSaving(true);
    try {
      await putApi("/settings/theme", { theme: newTheme });
    } finally {
      setSaving(false);
    }
  }

  async function handleFontSizeChange(size: number) {
    setPreferences({ ...preferences, fontSize: size });
    setSaving(true);
    try {
      await putApi("/settings/user", { preferences: { fontSize: size } });
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
              <button
                key={value}
                onClick={() => handleThemeChange(value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  preferences.theme === value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-sm font-medium">{label}</span>
              </button>
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
              onChange={(e) => handleFontSizeChange(Number(e.target.value))}
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
          <select
            value={preferences.fontFamily}
            onChange={(e) => setPreferences({ ...preferences, fontFamily: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="system-ui, -apple-system, sans-serif">系统默认</option>
            <option value="'Segoe UI', Tahoma, Geneva, Verdana, sans-serif">Segoe UI</option>
            <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica</option>
            <option value="'PingFang SC', 'Microsoft YaHei', sans-serif">苹方 / 微软雅黑</option>
          </select>
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
