import { useEffect, useState } from "react";

import { useApi, fetchJson, putApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";

interface SettingsSectionContentProps {
  readonly sectionId: string;
  readonly onSectionChange?: (sectionId: string) => void;
}

/* ── shared types from /api/settings/user ── */

interface UserProfile {
  name?: string;
  email?: string;
  avatar?: string;
  gitName?: string;
  gitEmail?: string;
}

interface UserPreferences {
  theme?: "light" | "dark" | "auto";
  fontSize?: number;
  fontFamily?: string;
  editorLineHeight?: number;
  editorTabSize?: number;
  autoSave?: boolean;
  autoSaveDelay?: number;
}

interface RuntimeRecovery {
  resumeOnStartup?: boolean;
  maxRecoveryAttempts?: number;
  maxRetryAttempts?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

interface RuntimeToolAccess {
  allowlist?: string[];
  blocklist?: string[];
  mcpStrategy?: string;
}

interface RuntimeDebug {
  tokenDebugEnabled?: boolean;
  rateDebugEnabled?: boolean;
  dumpEnabled?: boolean;
  traceEnabled?: boolean;
}

interface RuntimeControls {
  defaultPermissionMode?: string;
  defaultReasoningEffort?: string;
  contextCompressionThresholdPercent?: number;
  contextTruncateTargetPercent?: number;
  recovery?: RuntimeRecovery;
  toolAccess?: RuntimeToolAccess;
  runtimeDebug?: RuntimeDebug;
}

interface ModelDefaults {
  defaultSessionModel?: string;
  summaryModel?: string;
  subagentModelPool?: string[];
}

interface UserConfig {
  profile: UserProfile;
  preferences: UserPreferences;
  runtimeControls: RuntimeControls;
  modelDefaults: ModelDefaults;
}

interface ReleaseSnapshot {
  version?: string;
  commit?: string;
  platform?: string;
  builtAt?: string;
  nodeVersion?: string;
  bunVersion?: string;
}

/* ── component ── */

export function SettingsSectionContent({ sectionId, onSectionChange }: SettingsSectionContentProps) {
  switch (sectionId) {
    case "profile": return <ProfileSection />;
    case "models": return <ModelsSection onSectionChange={onSectionChange} />;
    case "agents": return <AgentsSection />;
    case "notifications": return <NotificationsSection />;
    case "appearance": return <AppearanceSection />;
    case "server": return <ServerSection />;
    case "storage": return <StorageSection />;
    case "resources": return <ResourcesSection />;
    case "history": return <HistorySection />;
    case "about": return <AboutSection />;
    default: return <ModelsSection onSectionChange={onSectionChange} />;
  }
}

/* ── helpers ── */

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={`${title}设置`} className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{value ?? "—"}</span>
    </div>
  );
}

function SaveBtn({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" disabled={saving} onClick={onClick} type="button">
      {saving ? "保存中…" : "保存"}
    </button>
  );
}

function NotConnected({ label }: { label: string }) {
  return <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">未接入 · {label}</span>;
}

/* ── Profile ── */

function ProfileSection() {
  const { data, loading, error } = useApi<{ profile: UserProfile; preferences: UserPreferences; runtimeControls: RuntimeControls; modelDefaults: ModelDefaults }>("/settings/user");
  const [gitName, setGitName] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.profile) {
      setGitName(data.profile.gitName ?? "");
      setGitEmail(data.profile.gitEmail ?? "");
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await putApi("/settings/user", { profile: { gitName, gitEmail } });
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionShell title="个人资料">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      {saveError && <InlineError message={saveError} />}
      <Field label="Git 用户名">
        <input className="w-48 rounded-lg border border-border bg-background px-2 py-1 text-sm" value={gitName} onChange={(e) => setGitName(e.target.value)} />
      </Field>
      <Field label="Git 邮箱">
        <input className="w-48 rounded-lg border border-border bg-background px-2 py-1 text-sm" value={gitEmail} onChange={(e) => setGitEmail(e.target.value)} />
      </Field>
      <div className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
        <span className="text-muted-foreground">头像上传</span>
        <NotConnected label="头像上传未接入" />
      </div>
      <div className="pt-1">
        <SaveBtn saving={saving} onClick={() => void handleSave()} />
      </div>
    </SectionShell>
  );
}

/* ── Models ── */

function ModelsSection({ onSectionChange }: { onSectionChange?: (id: string) => void }) {
  const { data, loading, error } = useApi<UserConfig>("/settings/user");
  const md = data?.modelDefaults;

  return (
    <SectionShell title="模型">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      <ReadonlyField label="默认模型" value={md?.defaultSessionModel} />
      <ReadonlyField label="摘要模型" value={md?.summaryModel} />
      <ReadonlyField label="Explore 子代理模型" value={md?.subagentModelPool?.[0]} />
      <ReadonlyField label="Plan 子代理模型" value={md?.subagentModelPool?.[1]} />
      <ReadonlyField label="模型池限制" value={md?.subagentModelPool ? `${md.subagentModelPool.length} 个` : "—"} />
      <ReadonlyField label="全局推理强度" value={data?.runtimeControls?.defaultReasoningEffort} />
      <ReadonlyField label="Codex 推理强度" value="—" />
      <div className="pt-1">
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => onSectionChange?.("providers")} type="button">打开 AI 供应商</button>
      </div>
    </SectionShell>
  );
}

/* ── Agents ── */

function AgentsSection() {
  const { data, loading, error } = useApi<UserConfig>("/settings/user");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [permMode, setPermMode] = useState("");
  const [compressThreshold, setCompressThreshold] = useState("80");
  const [truncateTarget, setTruncateTarget] = useState("70");
  const [tokenDebug, setTokenDebug] = useState(false);
  const [rateDebug, setRateDebug] = useState(false);
  const [dumpEnabled, setDumpEnabled] = useState(false);

  useEffect(() => {
    if (data?.runtimeControls) {
      const rc = data.runtimeControls;
      setPermMode(rc.defaultPermissionMode ?? "ask");
      setCompressThreshold(String(rc.contextCompressionThresholdPercent ?? 80));
      setTruncateTarget(String(rc.contextTruncateTargetPercent ?? 70));
      setTokenDebug(rc.runtimeDebug?.tokenDebugEnabled ?? false);
      setRateDebug(rc.runtimeDebug?.rateDebugEnabled ?? false);
      setDumpEnabled(rc.runtimeDebug?.dumpEnabled ?? false);
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await putApi("/settings/user", {
        runtimeControls: {
          defaultPermissionMode: permMode,
          contextCompressionThresholdPercent: Number(compressThreshold),
          contextTruncateTargetPercent: Number(truncateTarget),
          runtimeDebug: { tokenDebugEnabled: tokenDebug, rateDebugEnabled: rateDebug, dumpEnabled: dumpEnabled },
        },
      });
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const rc = data?.runtimeControls;

  return (
    <SectionShell title="AI 代理">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      {saveError && <InlineError message={saveError} />}
      <Field label="默认权限模式">
        <select className="rounded-lg border border-border bg-background px-2 py-1 text-sm" value={permMode} onChange={(e) => setPermMode(e.target.value)}>
          <option value="allow">allow</option>
          <option value="ask">ask</option>
          <option value="deny">deny</option>
        </select>
      </Field>
      <ReadonlyField label="每条消息最大轮次" value="—" />
      <ReadonlyField label="可恢复错误最大重试次数" value={String(rc?.recovery?.maxRetryAttempts ?? "—")} />
      <ReadonlyField label="重试退避时间上限" value={rc?.recovery?.maxRetryDelayMs ? `${rc.recovery.maxRetryDelayMs}ms` : "—"} />
      <ReadonlyField label="WebFetch 代理模式" value="—" />
      <Field label="上下文窗口阈值">
        <input className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm text-right" value={compressThreshold} onChange={(e) => setCompressThreshold(e.target.value)} />
      </Field>
      <Field label="token 用量 / 输出速率">
        <span className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={tokenDebug} onChange={(e) => setTokenDebug(e.target.checked)} /> token</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={rateDebug} onChange={(e) => setRateDebug(e.target.checked)} /> 速率</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={dumpEnabled} onChange={(e) => setDumpEnabled(e.target.checked)} /> dump</label>
        </span>
      </Field>
      <ReadonlyField label="目录 / 命令白名单黑名单" value={rc?.toolAccess?.mcpStrategy ?? "—"} />
      <div className="pt-1">
        <SaveBtn saving={saving} onClick={() => void handleSave()} />
      </div>
    </SectionShell>
  );
}

/* ── Notifications ── */

function NotificationsSection() {
  return (
    <SectionShell title="通知">
      <NotConnected label="未接入通知配置" />
    </SectionShell>
  );
}

/* ── Appearance ── */

function AppearanceSection() {
  const { data, loading, error } = useApi<{ theme: string }>("/settings/theme");
  const { data: editor } = useApi<{ fontSize?: number; fontFamily?: string; lineHeight?: number; tabSize?: number }>("/settings/editor");
  const [theme, setTheme] = useState("auto");
  const [fontSize, setFontSize] = useState("14");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setTheme(data.theme ?? "auto");
    if (editor) setFontSize(String(editor.fontSize ?? 14));
  }, [data, editor]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await putApi("/settings/theme", { theme });
      await putApi("/settings/editor", { fontSize: Number(fontSize) });
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionShell title="外观与界面">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      {saveError && <InlineError message={saveError} />}
      <Field label="主题模式">
        <select className="rounded-lg border border-border bg-background px-2 py-1 text-sm" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
          <option value="auto">跟随系统</option>
        </select>
      </Field>
      <Field label="字体大小">
        <input className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm text-right" type="number" min={12} max={20} value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
      </Field>
      <div className="pt-1">
        <SaveBtn saving={saving} onClick={() => void handleSave()} />
      </div>
    </SectionShell>
  );
}

/* ── Server ── */

function ServerSection() {
  const { data, loading, error } = useApi<Record<string, unknown>>("/settings/metrics");
  return (
    <SectionShell title="服务器与系统">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      <ReadonlyField label="启动诊断" value={data ? "已加载" : "—"} />
      <ReadonlyField label="运行时信息" value={typeof data?.bunVersion === "string" ? `Bun ${data.bunVersion}` : "—"} />
      <ReadonlyField label="SQLite 数据库" value={typeof data?.dbPath === "string" ? String(data.dbPath) : "—"} />
    </SectionShell>
  );
}

/* ── Storage ── */

function StorageSection() {
  const { data, loading, error } = useApi<Record<string, unknown>>("/settings/metrics");
  return (
    <SectionShell title="存储空间">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      <ReadonlyField label="SQLite 数据库" value={typeof data?.dbPath === "string" ? String(data.dbPath) : "—"} />
      <ReadonlyField label="会话存储" value="—" />
      <div className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
        <span className="text-muted-foreground">危险清理</span>
        <NotConnected label="未接入" />
      </div>
    </SectionShell>
  );
}

/* ── Resources ── */

function ResourcesSection() {
  const { data, loading, error } = useApi<Record<string, unknown>>("/settings/metrics");
  return (
    <SectionShell title="运行资源">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      <ReadonlyField label="Admin Resources" value={data ? "已加载" : "—"} />
      <ReadonlyField label="启动健康" value="—" />
    </SectionShell>
  );
}

/* ── History ── */

function HistorySection() {
  const { data, loading, error } = useApi<Record<string, unknown>>("/settings/metrics");
  return (
    <SectionShell title="使用历史">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      <ReadonlyField label="Admin Requests" value={data ? "已加载" : "—"} />
      <ReadonlyField label="AI request observability" value="—" />
    </SectionShell>
  );
}

/* ── About ── */

function AboutSection() {
  const { data, loading, error } = useApi<ReleaseSnapshot>("/settings/release");
  return (
    <SectionShell title="关于">
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
      {error && <InlineError message={error} />}
      <ReadonlyField label="版本 / commit / 平台 / 作者" value={data ? `${data.version ?? "—"} · ${data.commit?.slice(0, 7) ?? "—"} · ${data.platform ?? "—"}` : "—"} />
      <ReadonlyField label="Bun" value={data?.bunVersion} />
      <ReadonlyField label="构建时间" value={data?.builtAt} />
    </SectionShell>
  );
}
