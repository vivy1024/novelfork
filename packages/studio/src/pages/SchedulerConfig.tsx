/**
 * P1-6: Scheduler 高级配置 UI
 * 编辑 daemon 调度参数、QualityGates、每日上限等
 */
import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Clock, Shield, Save, RotateCcw } from "lucide-react";

interface Nav {
  toDashboard: () => void;
  toWorkflow: () => void;
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

export function SchedulerConfig({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [form, setForm] = useState<DaemonConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchJson<{ daemon?: DaemonConfig }>("/project")
      .then((data) => {
        if (data && typeof data === "object" && "daemon" in data && data.daemon) {
          setForm({ ...DEFAULTS, ...data.daemon, schedule: { ...DEFAULTS.schedule, ...data.daemon.schedule }, qualityGates: { ...DEFAULTS.qualityGates, ...data.daemon.qualityGates } });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      notify.error("保存失败", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setForm(DEFAULTS);

  const updateField = <K extends keyof DaemonConfig>(key: K, value: DaemonConfig[K]) =>
    setForm({ ...form, [key]: value });

  const updateGate = (key: keyof DaemonConfig["qualityGates"], value: number) =>
    setForm({ ...form, qualityGates: { ...form.qualityGates, [key]: value } });

  const updateSchedule = (key: keyof DaemonConfig["schedule"], value: string) =>
    setForm({ ...form, schedule: { ...form.schedule, [key]: value } });

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <button onClick={nav.toWorkflow} className={c.link}>工作流配置</button>
        <span className="text-border">/</span>
        <span className="text-foreground">调度配置</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">调度配置</h1>
        <div className="flex gap-2">
          <button onClick={handleReset} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary} flex items-center gap-1`}>
            <RotateCcw size={12} />恢复默认
          </button>
          <button onClick={handleSave} disabled={saving} className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50 flex items-center gap-1`}>
            <Save size={12} />{saving ? "保存中..." : saved ? "已保存" : "保存"}
          </button>
        </div>
      </div>

      {/* 调度时间 */}
      <Section icon={<Clock size={16} />} title="调度时间" c={c}>
        <Row label="写作周期 (cron)" c={c}>
          <input type="text" value={form.schedule.writeCron} onChange={(e) => updateSchedule("writeCron", e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm w-48 font-mono`} />
        </Row>
        <Row label="雷达扫描 (cron)" c={c}>
          <input type="text" value={form.schedule.radarCron} onChange={(e) => updateSchedule("radarCron", e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm w-48 font-mono`} />
        </Row>
      </Section>

      {/* 写作参数 */}
      <Section icon={<Clock size={16} />} title="写作参数" c={c}>
        <NumRow label="最大并发书籍" value={form.maxConcurrentBooks} min={1} max={10} onChange={(v) => updateField("maxConcurrentBooks", v)} c={c} />
        <NumRow label="每周期章节数" value={form.chaptersPerCycle} min={1} max={20} onChange={(v) => updateField("chaptersPerCycle", v)} c={c} />
        <NumRow label="每日章节上限" value={form.maxChaptersPerDay} min={1} max={200} onChange={(v) => updateField("maxChaptersPerDay", v)} c={c} />
        <NumRow label="章节间冷却 (ms)" value={form.cooldownAfterChapterMs} min={0} max={300000} step={1000} onChange={(v) => updateField("cooldownAfterChapterMs", v)} c={c} />
        <NumRow label="重试延迟 (ms)" value={form.retryDelayMs} min={0} max={300000} step={1000} onChange={(v) => updateField("retryDelayMs", v)} c={c} />
      </Section>

      {/* 质量门控 */}
      <Section icon={<Shield size={16} />} title="质量门控 (QualityGates)" c={c}>
        <NumRow label="最大审计重试次数" value={form.qualityGates.maxAuditRetries} min={0} max={10} onChange={(v) => updateGate("maxAuditRetries", v)} c={c} />
        <NumRow label="连续失败暂停阈值" value={form.qualityGates.pauseAfterConsecutiveFailures} min={1} max={20} onChange={(v) => updateGate("pauseAfterConsecutiveFailures", v)} c={c} />
        <NumRow label="重试温度步进" value={form.qualityGates.retryTemperatureStep} min={0} max={0.5} step={0.05} onChange={(v) => updateGate("retryTemperatureStep", v)} c={c} />
      </Section>
    </div>
  );
}

function Section({ icon, title, c, children }: { icon: React.ReactNode; title: string; c: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2 mb-3">{icon}{title}</h2>
      <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>{children}</div>
    </div>
  );
}

function Row({ label, c, children }: { label: string; c: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      {children}
    </div>
  );
}

function NumRow({ label, value, min, max, step, onChange, c }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; c: ReturnType<typeof useColors>;
}) {
  return (
    <Row label={label} c={c}>
      <input type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${c.input} rounded px-2 py-1 text-sm w-32 text-right font-mono`} />
    </Row>
  );
}
