import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface NotificationConfig {
  browserNotifications: boolean;
  soundEnabled: boolean;
  events: {
    permissionRequest: boolean;
    taskComplete: boolean;
    error: boolean;
    backgroundComplete: boolean;
  };
  soundVolume: number;
}

const DEFAULT_CONFIG: NotificationConfig = {
  browserNotifications: false,
  soundEnabled: false,
  events: {
    permissionRequest: true,
    taskComplete: true,
    error: true,
    backgroundComplete: true,
  },
  soundVolume: 70,
};

function SwitchRow({ label, description, checked, onChange, disabled }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function getPermissionStatus(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function NotificationSettingsPanel() {
  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_CONFIG);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | "unsupported">(getPermissionStatus);
  const [testSent, setTestSent] = useState(false);

  const handleRequestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermissionStatus(result);
    if (result === "granted") {
      setConfig((prev) => ({ ...prev, browserNotifications: true }));
    }
  }, []);

  const handleTestNotification = useCallback(() => {
    if (permissionStatus !== "granted") return;
    new Notification("NovelFork", {
      body: "测试通知 — 通知功能工作正常。",
      icon: "/favicon.ico",
    });
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  }, [permissionStatus]);

  const handleBrowserToggle = useCallback((value: boolean) => {
    if (value && permissionStatus !== "granted") {
      void handleRequestPermission();
      return;
    }
    setConfig((prev) => ({ ...prev, browserNotifications: value }));
  }, [handleRequestPermission, permissionStatus]);

  const updateEvent = useCallback((key: keyof NotificationConfig["events"], value: boolean) => {
    setConfig((prev) => ({
      ...prev,
      events: { ...prev.events, [key]: value },
    }));
  }, []);

  const permissionLabel = (() => {
    switch (permissionStatus) {
      case "granted": return "已授权";
      case "denied": return "已拒绝（需在浏览器设置中手动开启）";
      case "default": return "未请求";
      case "unsupported": return "当前环境不支持";
    }
  })();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2 text-foreground">通知</h2>
        <p className="text-sm text-muted-foreground">配置浏览器通知和声音提醒，及时了解任务进度。</p>
      </div>

      {/* 权限状态 */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">通知权限</h3>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-muted-foreground">浏览器通知权限</span>
            <p className="text-xs text-muted-foreground">{permissionLabel}</p>
          </div>
          {permissionStatus === "default" && (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleRequestPermission()}>
              请求权限
            </Button>
          )}
        </div>
      </div>

      {/* 通知开关 */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">通知方式</h3>

        <SwitchRow
          label="浏览器通知"
          description="在系统通知中心显示消息"
          checked={config.browserNotifications}
          onChange={handleBrowserToggle}
          disabled={permissionStatus === "denied" || permissionStatus === "unsupported"}
        />

        <SwitchRow
          label="声音提醒"
          description="播放提示音"
          checked={config.soundEnabled}
          onChange={(value) => setConfig((prev) => ({ ...prev, soundEnabled: value }))}
        />

        {config.soundEnabled && (
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">音量 ({config.soundVolume}%)</span>
            <input
              type="range"
              min={0}
              max={100}
              value={config.soundVolume}
              onChange={(e) => setConfig((prev) => ({ ...prev, soundVolume: Number(e.currentTarget.value) }))}
              className="w-full accent-primary"
            />
          </label>
        )}
      </div>

      {/* 事件类型 */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">通知事件</h3>
        <p className="text-xs text-muted-foreground">选择哪些事件触发通知。</p>

        <SwitchRow
          label="权限请求"
          description="Agent 请求工具执行权限时通知"
          checked={config.events.permissionRequest}
          onChange={(value) => updateEvent("permissionRequest", value)}
        />

        <SwitchRow
          label="任务完成"
          description="写作任务或 Agent 任务完成时通知"
          checked={config.events.taskComplete}
          onChange={(value) => updateEvent("taskComplete", value)}
        />

        <SwitchRow
          label="错误"
          description="发生错误或异常时通知"
          checked={config.events.error}
          onChange={(value) => updateEvent("error", value)}
        />

        <SwitchRow
          label="后台任务完成"
          description="后台运行的长时间任务完成时通知"
          checked={config.events.backgroundComplete}
          onChange={(value) => updateEvent("backgroundComplete", value)}
        />
      </div>

      {/* 测试按钮 */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTestNotification}
          disabled={permissionStatus !== "granted"}
        >
          {testSent ? "已发送" : "测试通知"}
        </Button>
        {permissionStatus !== "granted" && (
          <span className="self-center text-xs text-muted-foreground">需先授权浏览器通知权限</span>
        )}
      </div>
    </div>
  );
}
