import { useEffect, useState } from "react";
import { Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/lib/notify";
import {
  createChapterContainerSettingsClient,
  type RuntimeChapterContainerSettingsPatch,
} from "../../runtime-admin/chapter-containers";

const client = createChapterContainerSettingsClient();

const DEFAULTS: RuntimeChapterContainerSettingsPatch = {
  chapters: {
    maxActiveWorktrees: 10,
    maxActiveContainers: 5,
    worktreeSizeWarningMb: 500,
    autoSaveOnDormant: true,
    dormantAfterMinutes: 0,
  },
  containers: {
    portRangeStart: 10000,
    portRangeEnd: 20000,
    proxy: { enabled: false, port: 7780 },
  },
};

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function NumberSetting({ label, description, value, min, max, suffix, onChange }: {
  readonly label: string;
  readonly description?: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly suffix?: string;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
      <span>
        <span className="block font-medium text-foreground">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <Input
          aria-label={label}
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(numberValue(event.currentTarget.value, value))}
        />
        {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SwitchSetting({ label, description, checked, onChange }: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ChaptersContainersPanel() {
  const [form, setForm] = useState<RuntimeChapterContainerSettingsPatch>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.get()
      .then((settings) => {
        if (!active) return;
        setForm({
          chapters: {
            maxActiveWorktrees: settings.chapters?.maxActiveWorktrees ?? DEFAULTS.chapters.maxActiveWorktrees,
            maxActiveContainers: settings.chapters?.maxActiveContainers ?? DEFAULTS.chapters.maxActiveContainers,
            worktreeSizeWarningMb: settings.chapters?.worktreeSizeWarningMb ?? DEFAULTS.chapters.worktreeSizeWarningMb,
            autoSaveOnDormant: settings.chapters?.autoSaveOnDormant ?? DEFAULTS.chapters.autoSaveOnDormant,
            dormantAfterMinutes: settings.chapters?.dormantAfterMinutes ?? DEFAULTS.chapters.dormantAfterMinutes,
          },
          containers: {
            portRangeStart: settings.containers?.portRangeStart ?? DEFAULTS.containers.portRangeStart,
            portRangeEnd: settings.containers?.portRangeEnd ?? DEFAULTS.containers.portRangeEnd,
            proxy: {
              enabled: settings.containers?.proxy?.enabled ?? DEFAULTS.containers.proxy.enabled,
              port: settings.containers?.proxy?.port ?? DEFAULTS.containers.proxy.port,
            },
          },
        });
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function updateChapter<K extends keyof RuntimeChapterContainerSettingsPatch["chapters"]>(
    key: K,
    value: RuntimeChapterContainerSettingsPatch["chapters"][K],
  ) {
    setForm((current) => ({ ...current, chapters: { ...current.chapters, [key]: value } }));
  }

  function updateContainer<K extends "portRangeStart" | "portRangeEnd">(
    key: K,
    value: RuntimeChapterContainerSettingsPatch["containers"][K],
  ) {
    setForm((current) => ({ ...current, containers: { ...current.containers, [key]: value } }));
  }

  async function save() {
    if (form.containers.portRangeStart > form.containers.portRangeEnd) {
      setError("容器端口范围起始值不能大于结束值。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await client.patch(form);
      notify.success("章节与容器设置已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">正在读取章节与容器设置…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">章节与容器</h2>
        <p className="text-sm text-muted-foreground">配置 Runtime 的章节工作树、容器并发、休眠保存和端口范围。</p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>章节与容器设置未保存</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>章节</CardTitle>
          <CardDescription>这些字段直接对应 Runtime settings.chapters。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <NumberSetting label="最大活动工作树" value={form.chapters.maxActiveWorktrees} min={1} max={50} onChange={(value) => updateChapter("maxActiveWorktrees", value)} />
          <NumberSetting label="最大活动容器" value={form.chapters.maxActiveContainers} min={1} max={20} onChange={(value) => updateChapter("maxActiveContainers", value)} />
          <NumberSetting label="工作树大小警告" value={form.chapters.worktreeSizeWarningMb} min={100} suffix="MB" onChange={(value) => updateChapter("worktreeSizeWarningMb", value)} />
          <SwitchSetting label="休眠时自动保存" description="章节进入休眠状态时自动保存工作内容。" checked={form.chapters.autoSaveOnDormant} onChange={(value) => updateChapter("autoSaveOnDormant", value)} />
          <NumberSetting label="进入休眠的分钟数" description="0 表示禁用自动休眠。" value={form.chapters.dormantAfterMinutes} min={0} onChange={(value) => updateChapter("dormantAfterMinutes", value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>容器</CardTitle>
          <CardDescription>这些字段直接对应 Runtime settings.containers。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <NumberSetting label="端口范围起始值" value={form.containers.portRangeStart} min={1024} max={65535} onChange={(value) => updateContainer("portRangeStart", value)} />
          <NumberSetting label="端口范围结束值" value={form.containers.portRangeEnd} min={1024} max={65535} onChange={(value) => updateContainer("portRangeEnd", value)} />
          <SwitchSetting
            label="启用容器代理"
            description="通过 Runtime 容器代理暴露章节服务。"
            checked={form.containers.proxy.enabled}
            onChange={(enabled) => setForm((current) => ({ ...current, containers: { ...current.containers, proxy: { ...current.containers.proxy, enabled } } }))}
          />
          {form.containers.proxy.enabled ? (
            <NumberSetting
              label="容器代理端口"
              description="Runtime 容器代理监听端口。"
              value={form.containers.proxy.port}
              min={1024}
              max={65535}
              onChange={(port) => setForm((current) => ({ ...current, containers: { ...current.containers, proxy: { ...current.containers.proxy, port } } }))}
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          <Save data-icon="inline-start" />
          {saving ? "保存中…" : "保存章节与容器设置"}
        </Button>
      </div>
    </div>
  );
}
