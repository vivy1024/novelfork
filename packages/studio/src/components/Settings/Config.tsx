import React, { useEffect, useMemo, useState } from "react";
import { Database, RotateCcw, Save, Search } from "lucide-react";
import { openDB, IDBPDatabase } from "idb";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ModelPicker } from "../Model/ModelPicker";

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
  modelProvider: string;
  modelId: string;
}

const DB_NAME = "novelfork-settings";
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
  } catch (error) {
    console.error("Failed to save settings:", error);
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
    modelProvider: "anthropic",
    modelId: "claude-sonnet-4-6",
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

  const settingsList: Setting[] = useMemo(
    () => [
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
        id: "autoSave",
        label: "自动保存",
        description: "编辑后自动保存内容",
        type: "boolean",
        value: settings.autoSave,
      },
      {
        id: "autoCompressContext",
        label: "自动压缩上下文",
        description: "自动压缩长对话上下文",
        type: "boolean",
        value: settings.autoCompressContext,
      },
    ],
    [settings],
  );

  const filteredSettings = useMemo(() => {
    if (!searchQuery.trim()) return settingsList;
    const query = searchQuery.toLowerCase();
    return settingsList.filter(
      (setting) =>
        setting.label.toLowerCase().includes(query) ||
        setting.description?.toLowerCase().includes(query) ||
        setting.id.toLowerCase().includes(query),
    );
  }, [searchQuery, settingsList]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(initialSettings);
  }, [settings, initialSettings]);

  const handleChange = (id: string, value: SettingValue) => {
    setSettings((prev) => ({ ...prev, [id]: value }));
  };

  const handleModelChange = (providerId: string, modelId: string) => {
    setSettings((prev) => ({ ...prev, modelProvider: providerId, modelId }));
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
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && hasChanges) {
        event.stopPropagation();
        handleRevert();
      }
    };

    window.addEventListener("keydown", handleEsc, { capture: true });
    return () => window.removeEventListener("keydown", handleEsc, { capture: true });
  }, [hasChanges, initialSettings]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">配置</h2>
          <p className="text-sm text-muted-foreground">选择主题、语言和常用编辑偏好。</p>
        </div>
        <Badge variant="outline">
          {filteredSettings.length}/{settingsList.length} 项
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-5 text-primary" />
            配置筛选
          </CardTitle>
          <CardDescription>搜索配置项，快速定位需要调整的选项。</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="text"
            placeholder="搜索配置项..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-primary" />
            AI 模型
          </CardTitle>
          <CardDescription>选择默认模型供应商和模型 ID。</CardDescription>
        </CardHeader>
        <CardContent>
          <ModelPicker
            value={{ providerId: settings.modelProvider, modelId: settings.modelId }}
            onChange={handleModelChange}
            theme={theme}
          />
        </CardContent>
      </Card>

      {filteredSettings.length === 0 ? (
        <PageEmptyState
          title="未找到匹配的配置项"
          description="试试换一个关键词，或者清空搜索后重新浏览。"
          action={<Button variant="outline" onClick={() => setSearchQuery("")}>清除搜索</Button>}
        />
      ) : (
        <div className="space-y-3">
          {filteredSettings.map((setting) => (
            <Card key={setting.id} size="sm">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{setting.label}</p>
                    <Badge variant="outline">{setting.id}</Badge>
                  </div>
                  {setting.description && <p className="text-xs text-muted-foreground">{setting.description}</p>}
                </div>
                <div className="flex-shrink-0">
                  {setting.type === "boolean" && (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={setting.value as boolean}
                        onChange={(event) => handleChange(setting.id, event.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 rounded-full bg-input transition-colors peer-checked:bg-primary after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow-lg after:transition-transform peer-checked:after:translate-x-full" />
                    </label>
                  )}
                  {setting.type === "enum" && setting.options && (
                    <select
                      value={setting.value as string}
                      onChange={(event) => handleChange(setting.id, event.target.value)}
                      className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                    >
                      {setting.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hasChanges && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button onClick={() => void handleSave()} disabled={saving}>
            <Save className="size-4" />
            {saving ? "保存中..." : "保存更改"}
          </Button>
          <Button variant="outline" onClick={handleRevert}>
            <RotateCcw className="size-4" />
            回滚 (Esc)
          </Button>
        </div>
      )}
    </div>
  );
});
