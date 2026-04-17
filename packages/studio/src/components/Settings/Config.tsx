import React, { useState, useEffect, useMemo } from "react";
import { Search, RotateCcw, Save } from "lucide-react";
import { openDB, IDBPDatabase } from "idb";

interface ConfigProps {
  theme: "light" | "dark";
}

type SettingValue = boolean | string;

interface Setting {
  id: string;
  label: string;
  description?: string;
  type: "boolean" | "enum";
  value: SettingValue;
  options?: string[];
}

interface SettingsState {
  autoSave: boolean;
  theme: string;
  language: string;
  fontSize: string;
  showLineNumbers: boolean;
  autoCompressContext: boolean;
}

const DB_NAME = "inkos-settings";
const DB_VERSION = 1;
const STORE_NAME = "config";

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

async function loadSettings(): Promise<SettingsState> {
  try {
    const db = await getDB();
    const stored = await db.get(STORE_NAME, "settings");
    return stored || getDefaultSettings();
  } catch {
    return getDefaultSettings();
  }
}

async function saveSettings(settings: SettingsState): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, settings, "settings");
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function getDefaultSettings(): SettingsState {
  return {
    autoSave: true,
    theme: "auto",
    language: "zh-CN",
    fontSize: "medium",
    showLineNumbers: true,
    autoCompressContext: false,
  };
}

export const Config = React.memo(function Config({ theme }: ConfigProps) {
  const [settings, setSettings] = useState<SettingsState>(getDefaultSettings());
  const [initialSettings, setInitialSettings] = useState<SettingsState>(getDefaultSettings());
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings().then((loaded) => {
      setSettings(loaded);
      setInitialSettings(loaded);
    });
  }, []);

  const settingsList: Setting[] = useMemo(() => [
    {
      id: "autoSave",
      label: "自动保存",
      description: "编辑后自动保存内容",
      type: "boolean",
      value: settings.autoSave,
    },
    {
      id: "theme",
      label: "主题",
      description: "选择界面主题",
      type: "enum",
      value: settings.theme,
      options: ["light", "dark", "auto"],
    },
    {
      id: "language",
      label: "语言",
      description: "界面显示语言",
      type: "enum",
      value: settings.language,
      options: ["zh-CN", "en-US"],
    },
    {
      id: "fontSize",
      label: "字体大小",
      description: "编辑器字体大小",
      type: "enum",
      value: settings.fontSize,
      options: ["small", "medium", "large"],
    },
    {
      id: "showLineNumbers",
      label: "显示行号",
      description: "在编辑器中显示行号",
      type: "boolean",
      value: settings.showLineNumbers,
    },
    {
      id: "autoCompressContext",
      label: "自动压缩上下文",
      description: "自动压缩长对话上下文",
      type: "boolean",
      value: settings.autoCompressContext,
    },
  ], [settings]);

  const filteredSettings = useMemo(() => {
    if (!searchQuery.trim()) return settingsList;
    const query = searchQuery.toLowerCase();
    return settingsList.filter(
      (s) =>
        s.label.toLowerCase().includes(query) ||
        s.description?.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query)
    );
  }, [settingsList, searchQuery]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(initialSettings);
  }, [settings, initialSettings]);

  const handleChange = (id: string, value: SettingValue) => {
    setSettings((prev) => ({ ...prev, [id]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    await saveSettings(settings);
    setInitialSettings(settings);
    setSaving(false);
  };

  const handleRevert = () => {
    setSettings(initialSettings);
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hasChanges) {
        e.stopPropagation();
        handleRevert();
      }
    };
    window.addEventListener("keydown", handleEsc, { capture: true });
    return () => window.removeEventListener("keydown", handleEsc, { capture: true });
  }, [hasChanges, initialSettings]);

  return (
    <div className="p-6 space-y-6">
      {/* 搜索栏 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索配置项..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* 配置项列表 */}
      <div className="space-y-4">
        {filteredSettings.map((setting) => (
          <div
            key={setting.id}
            className="p-4 rounded-lg border border-border bg-background/50 hover:bg-background/80 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground block mb-1">
                  {setting.label}
                </label>
                {setting.description && (
                  <p className="text-xs text-muted-foreground">{setting.description}</p>
                )}
              </div>
              <div className="flex-shrink-0">
                {setting.type === "boolean" && (
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setting.value as boolean}
                      onChange={(e) => handleChange(setting.id, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                  </label>
                )}
                {setting.type === "enum" && setting.options && (
                  <select
                    value={setting.value as string}
                    onChange={(e) => handleChange(setting.id, e.target.value)}
                    className="px-3 py-1.5 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {setting.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      {hasChanges && (
        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "保存中..." : "保存更改"}
          </button>
          <button
            onClick={handleRevert}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground hover:bg-secondary transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            回滚 (Esc)
          </button>
        </div>
      )}

      {filteredSettings.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          未找到匹配的配置项
        </div>
      )}
    </div>
  );
});
