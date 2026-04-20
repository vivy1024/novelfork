/**
 * P1-6: Scheduler 高级配置 UI
 * 编辑 daemon 调度参数、QualityGates、每日上限等
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Clock, RefreshCw, RotateCcw, Save, Shield } from "lucide-react";

import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Nav {
  toWorkflow?: () => void;
}

interface DaemonConfig {
  schedule: { radarCron: string; writeCron: string };
  maxConcurrentBooks: number;
  chaptersPerCycle: number;
  retryDelayMs: number;
  cooldownAfterChapterMs: number;
  maxChaptersPerDay: number;
  qualityGates: {
    maxAuditRetries: number;
    pauseAfterConsecutiveFailures: number;
    retryTemperatureStep: number;
  };
}

const DEFAULTS: DaemonConfig = {
  schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" },
  maxConcurrentBooks: 3,
  chaptersPerCycle: 1,
  retryDelayMs: 30000,
  cooldownAfterChapterMs: 10000,
  maxChaptersPerDay: 50,
  qualityGates: {
    maxAuditRetries: 2,
    pauseAfterConsecutiveFailures: 3,
    retryTemperatureStep: 0.1,
  },
};

export function SchedulerConfig({ nav, theme }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [form, setForm] = useState<DaemonConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ daemon?: DaemonConfig }>("/project");
      if (data && typeof data === "object" && "daemon" in data && data.daemon) {
        setForm({
          ...DEFAULTS,
          ...data.daemon,
          schedule: { ...DEFAULTS.schedule, ...data.daemon.schedule },
          qualityGates: { ...DEFAULTS.qualityGates, ...data.daemon.qualityGates },
        });
      } else {
        setForm(DEFAULTS);
      }
    } catch {
      // 刷新失败时保留当前表单，避免把已编辑内容冲掉。
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetchJson("/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daemon: form }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="调度配置"
        description="在工作流配置台集中管理守护进程的调度节奏、写作并发与质量门控。"
        actions={
          <>
            {nav.toWorkflow && (
              <button onClick={() => nav.toWorkflow?.()} className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70">
                工作流总览
              </button>
            )}
            <button onClick={() => void loadConfig()} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RefreshCw size={12} />刷新
            </button>
            <button onClick={() => setForm(DEFAULTS)} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RotateCcw size={12} />恢复默认
            </button>
            <button onClick={handleSave} disabled={saving} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnPrimary} disabled:opacity-50 flex items-center gap-1`}>
              <Save size={12} />{saving ? "保存中..." : saved ? "已保存" : "保存"}
            </button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MiniStat title="写作周期" value={form.schedule.writeCron} note="cron / 写作轮询" />
        <MiniStat title="雷达扫描" value={form.schedule.radarCron} note="cron / 题材雷达" />
        <MiniStat title="每日上限" value={String(form.maxChaptersPerDay)} note="章节数量门槛" />
      </div>

      <Section icon={<Clock size={16} />} title="调度时间" c={c}>
        <Row label="写作周期 (cron)">
          <input
            type="text"
            value={form.schedule.writeCron}
            onChange={(e) => updateSchedule("writeCron", e.target.value)}
            className={`${c.input} w-48 rounded px-2 py-1 font-mono text-sm`}
          />
        </Row>
        <Row label="雷达扫描 (cron)">
          <input
            type="text"
            value={form.schedule.radarCron}
            onChange={(e) => updateSchedule("radarCron", e.target.value)}
            className={`${c.input} w-48 rounded px-2 py-1 font-mono text-sm`}
          />
        </Row>
      </Section>

      <Section icon={<Clock size={16} />} title="写作参数" c={c}>
        <NumRow label="最大并发书籍" value={form.maxConcurrentBooks} min={1} max={10} onChange={(v) => updateField("maxConcurrentBooks", v)} c={c} />
        <NumRow label="每周期章节数" value={form.chaptersPerCycle} min={1} max={20} onChange={(v) => updateField("chaptersPerCycle", v)} c={c} />
        <NumRow label="每日章节上限" value={form.maxChaptersPerDay} min={1} max={200} onChange={(v) => updateField("maxChaptersPerDay", v)} c={c} />
        <NumRow label="章节间冷却 (ms)" value={form.cooldownAfterChapterMs} min={0} max={300000} step={1000} onChange={(v) => updateField("cooldownAfterChapterMs", v)} c={c} />
        <NumRow label="重试延迟 (ms)" value={form.retryDelayMs} min={0} max={300000} step={1000} onChange={(v) => updateField("retryDelayMs", v)} c={c} />
      </Section>

      <Section icon={<Shield size={16} />} title="质量门控 (QualityGates)" c={c}>
        <NumRow label="最大审计重试次数" value={form.qualityGates.maxAuditRetries} min={0} max={10} onChange={(v) => updateGate("maxAuditRetries", v)} c={c} />
        <NumRow label="连续失败暂停阈值" value={form.qualityGates.pauseAfterConsecutiveFailures} min={1} max={20} onChange={(v) => updateGate("pauseAfterConsecutiveFailures", v)} c={c} />
        <NumRow label="重试温度步进" value={form.qualityGates.retryTemperatureStep} min={0} max={0.5} step={0.05} onChange={(v) => updateGate("retryTemperatureStep", v)} c={c} />
      </Section>
    </div>
  );

  function updateField<K extends keyof DaemonConfig>(key: K, value: DaemonConfig[K]) {
    setForm({ ...form, [key]: value });
  }

  function updateGate(key: keyof DaemonConfig["qualityGates"], value: number) {
    setForm({ ...form, qualityGates: { ...form.qualityGates, [key]: value } });
  }

  function updateSchedule(key: keyof DaemonConfig["schedule"], value: string) {
    setForm({ ...form, schedule: { ...form.schedule, [key]: value } });
  }
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Workflow Workbench</p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function MiniStat({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
      <div className="mt-2 break-all text-lg font-semibold tracking-tight text-foreground">{value}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
    </div>
  );
}

function Section({ icon, title, c, children }: { icon: ReactNode; title: string; c: ReturnType<typeof useColors>; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h2>
      <div className={`divide-y divide-border/40 rounded-lg border ${c.cardStatic}`}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function NumRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  c,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <Row label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${c.input} w-32 rounded px-2 py-1 text-right font-mono text-sm`}
      />
    </Row>
  );
}
