import { useState, useEffect } from "react";
import { useColors } from "../../hooks/use-colors";
import type { Theme } from "../../hooks/use-theme";
import { fetchJson, postApi } from "../../hooks/use-api";
import { Code, Type, Save } from "lucide-react";

interface EditorPreferences {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  autoSave: boolean;
  autoSaveDelay: number;
}

interface Props {
  theme: Theme;
}

export function EditorPanel({ theme }: Props) {
  const c = useColors(theme);
  const [prefs, setPrefs] = useState<EditorPreferences>({
    fontSize: 14,
    fontFamily: "system-ui, -apple-system, sans-serif",
    lineHeight: 1.6,
    tabSize: 2,
    autoSave: true,
    autoSaveDelay: 2000,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson<EditorPreferences>("/settings/editor")
      .then((data) => {
        setPrefs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await postApi("/settings/editor", prefs);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">编辑器</h2>
        <p className="text-sm text-muted-foreground">
          配置编辑器的外观和行为
        </p>
      </div>

      <div className={c.cardStatic + " space-y-6"}>
        {/* 字体大小 */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-3 text-foreground">
            <Type className="w-4 h-4" />
            编辑器字体大小
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="12"
              max="24"
              value={prefs.fontSize}
              onChange={(e) => setPrefs({ ...prefs, fontSize: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="text-sm font-mono text-muted-foreground w-12 text-right">
              {prefs.fontSize}px
            </span>
          </div>
        </div>

        {/* 字体族 */}
        <div>
          <label className="text-sm font-medium mb-2 block text-foreground">
            编辑器字体
          </label>
          <select
            value={prefs.fontFamily}
            onChange={(e) => setPrefs({ ...prefs, fontFamily: e.target.value })}
            className={c.input}
          >
            <option value="system-ui, -apple-system, sans-serif">系统默认</option>
            <option value="'Consolas', 'Monaco', 'Courier New', monospace">Consolas</option>
            <option value="'Fira Code', 'Cascadia Code', monospace">Fira Code</option>
            <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
            <option value="'Source Code Pro', monospace">Source Code Pro</option>
          </select>
        </div>

        {/* 行高 */}
        <div>
          <label className="text-sm font-medium mb-3 block text-foreground">
            行高
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="1.2"
              max="2.0"
              step="0.1"
              value={prefs.lineHeight}
              onChange={(e) => setPrefs({ ...prefs, lineHeight: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="text-sm font-mono text-muted-foreground w-12 text-right">
              {prefs.lineHeight.toFixed(1)}
            </span>
          </div>
        </div>

        {/* Tab 大小 */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2 text-foreground">
            <Code className="w-4 h-4" />
            Tab 大小
          </label>
          <select
            value={prefs.tabSize}
            onChange={(e) => setPrefs({ ...prefs, tabSize: Number(e.target.value) })}
            className={c.input}
          >
            <option value="2">2 空格</option>
            <option value="4">4 空格</option>
            <option value="8">8 空格</option>
          </select>
        </div>

        {/* 自动保存 */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-3 text-foreground">
            <Save className="w-4 h-4" />
            自动保存
          </label>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={prefs.autoSave}
                onChange={(e) => setPrefs({ ...prefs, autoSave: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-foreground">启用自动保存</span>
            </label>
            {prefs.autoSave && (
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">
                  自动保存延迟（毫秒）
                </label>
                <input
                  type="number"
                  min="500"
                  max="10000"
                  step="500"
                  value={prefs.autoSaveDelay}
                  onChange={(e) => setPrefs({ ...prefs, autoSaveDelay: Number(e.target.value) })}
                  className={c.input}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  停止输入后等待 {prefs.autoSaveDelay}ms 自动保存
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className={c.btnPrimary}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
