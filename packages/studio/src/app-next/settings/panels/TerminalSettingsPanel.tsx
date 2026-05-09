import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface TerminalConfig {
  shell: string;
  defaultCwd: string;
  fontSize: number;
  scrollback: number;
  autoCloseOnExit: boolean;
}

interface TerminalSession {
  id: string;
  title: string;
  status: "running" | "exited";
  pid?: number;
  createdAt: string;
}

const DEFAULT_CONFIG: TerminalConfig = {
  shell: typeof navigator !== "undefined" && navigator.platform?.startsWith("Win") ? "powershell.exe" : "/bin/bash",
  defaultCwd: "",
  fontSize: 13,
  scrollback: 5000,
  autoCloseOnExit: false,
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
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 模拟加载终端配置（后端 API 就绪后替换）
    const timer = setTimeout(() => {
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleNewTerminal = () => {
    const newSession: TerminalSession = {
      id: crypto.randomUUID(),
      title: `终端 ${sessions.length + 1}`,
      status: "running",
      createdAt: new Date().toISOString(),
    };
    setSessions((prev) => [...prev, newSession]);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载终端配置中…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2 text-foreground">终端</h2>
        <p className="text-sm text-muted-foreground">终端 Shell 配置与活跃会话管理。</p>
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
            onChange={(e) => setConfig((prev) => ({ ...prev, fontSize: Number(e.currentTarget.value) || 13 }))}
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

        <SwitchRow
          label="退出时自动关闭"
          description="Shell 进程退出后自动关闭终端标签"
          checked={config.autoCloseOnExit}
          onChange={(value) => setConfig((prev) => ({ ...prev, autoCloseOnExit: value }))}
        />
      </div>

      {/* 活跃会话区 */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">活跃终端会话</h3>
          <Button type="button" variant="outline" size="sm" onClick={handleNewTerminal}>
            新建终端
          </Button>
        </div>

        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无活跃终端会话。点击"新建终端"创建一个。</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{session.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {session.pid ? `PID: ${session.pid} · ` : ""}
                    {new Date(session.createdAt).toLocaleTimeString("zh-CN")}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    session.status === "running"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  }`}
                >
                  {session.status === "running" ? "运行中" : "已退出"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 运行时状态 */}
      <div className="space-y-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">运行时状态</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Shell</span>
            <p className="font-mono text-foreground">{config.shell}</p>
          </div>
          <div>
            <span className="text-muted-foreground">活跃会话数</span>
            <p className="font-mono text-foreground">{sessions.filter((s) => s.status === "running").length}</p>
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
