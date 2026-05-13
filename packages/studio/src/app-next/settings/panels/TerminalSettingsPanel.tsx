import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchJson, putApi } from "@/hooks/use-api";
import { notify } from "@/lib/notify";

interface TerminalConfig {
  shell: string;
  defaultCwd: string;
  fontSize: number;
  scrollback: number;
  autoCloseOnExit: boolean;
  theme: "auto" | "dark" | "light";
}

const DEFAULT_CONFIG: TerminalConfig = {
  shell: typeof navigator !== "undefined" && navigator.platform?.startsWith("Win") ? "powershell.exe" : "/bin/bash",
  defaultCwd: "",
  fontSize: 14,
  scrollback: 5000,
  autoCloseOnExit: false,
  theme: "auto",
};

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

export function TerminalSettingsPanel() {
  const [config, setConfig] = useState<TerminalConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson<{ preferences?: { terminalFontSize?: number; terminalTheme?: "auto" | "dark" | "light" } }>("/settings/user")
      .then((data) => {
        if (data.preferences) {
          setConfig((prev) => ({
            ...prev,
            fontSize: data.preferences?.terminalFontSize ?? prev.fontSize,
            theme: data.preferences?.terminalTheme ?? prev.theme,
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (patch: Partial<TerminalConfig>) => {
    const updated = { ...config, ...patch };
    setConfig(updated);
    setSaving(true);
    try {
      await putApi("/settings/user", {
        preferences: {
          terminalFontSize: updated.fontSize,
          terminalTheme: updated.theme,
        },
      });
      notify.success("终端设置已保存");
    } catch {
      notify.error("保存失败");
    } finally {
      setSaving(false);
    }
  }, [config]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载终端配置中…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2 text-foreground">终端</h2>
        <p className="text-sm text-muted-foreground">终端 Shell 配置与显示偏好。</p>
      </div>

      {/* 配置区 */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Shell 配置</h3>

        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">Shell 路径</span>
          <Input
            value={config.shell}
            onChange={(e) => setConfig((prev) => ({ ...prev, shell: e.currentTarget.value }))}
            placeholder="powershell.exe 或 /bin/bash"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">默认工作目录</span>
          <Input
            value={config.defaultCwd}
            onChange={(e) => setConfig((prev) => ({ ...prev, defaultCwd: e.currentTarget.value }))}
            placeholder="留空则使用项目根目录"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">字体大小</span>
          <Input
            type="number"
            min={8}
            max={24}
            value={config.fontSize}
            onChange={(e) => setConfig((prev) => ({ ...prev, fontSize: Number(e.currentTarget.value) || 14 }))}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">回滚行数</span>
          <Input
            type="number"
            min={100}
            max={100000}
            value={config.scrollback}
            onChange={(e) => setConfig((prev) => ({ ...prev, scrollback: Number(e.currentTarget.value) || 5000 }))}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">终端主题</span>
          <select
            value={config.theme}
            onChange={(e) => setConfig((prev) => ({ ...prev, theme: e.currentTarget.value as "auto" | "dark" | "light" }))}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="auto">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>

        <SwitchRow
          label="退出时自动关闭"
          description="Shell 进程退出后自动关闭终端标签"
          checked={config.autoCloseOnExit}
          onChange={(value) => setConfig((prev) => ({ ...prev, autoCloseOnExit: value }))}
        />
      </div>

      {/* 保存按钮 */}
      <Button
        type="button"
        onClick={() => void save(config)}
        disabled={saving}
      >
        {saving ? "保存中…" : "保存设置"}
      </Button>

      {/* 运行时状态 */}
      <div className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">当前配置</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Shell</span>
            <p className="font-mono text-foreground">{config.shell}</p>
          </div>
          <div>
            <span className="text-muted-foreground">主题</span>
            <p className="font-mono text-foreground">{config.theme}</p>
          </div>
          <div>
            <span className="text-muted-foreground">字体大小</span>
            <p className="font-mono text-foreground">{config.fontSize}px</p>
          </div>
          <div>
            <span className="text-muted-foreground">回滚行数</span>
            <p className="font-mono text-foreground">{config.scrollback}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
