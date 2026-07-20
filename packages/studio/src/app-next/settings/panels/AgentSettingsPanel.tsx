import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import {
  createSettingsClient,
  createUserPreferencesClient,
  type AddRetryRuleInput,
  type RuntimeRetryRule,
  type RuntimeSettings,
  type RuntimeUserPreferences,
  type UserPreferencesPatch,
} from "../../runtime-admin";
import { useLocalBooleanPreference } from "../local-preferences";
import { SettingsGroup, SettingsPage, SettingsSaveBar, SettingsSwitchRow } from "../components/SettingsPage";
import { asRecord, type RuntimePermissionMode } from "../runtime-settings-utils";

const settingsClient = createSettingsClient();
const preferencesClient = createUserPreferencesClient();

type DangerReflectionLevel = "off" | "light" | "standard" | "strict";

interface AgentDraft {
  defaultPermissionMode: RuntimePermissionMode;
  defaultStartInPlanMode: boolean;
  maxTurns: number;
  legacyEncoding: boolean;
  freshShellEnv: boolean;
  translateReasoning: boolean;
  requestDumpEnabled: boolean;
  requestDumpErrorsOnly: boolean;
  defaultRelaxedPlan: boolean;
  defaultPruneEnabled: boolean;
  planModeAllowInlinePlan: boolean;
  planReflectionAutoApprove: boolean;
  planReflectionAllowAutoCompact: boolean;
  questionReflectionEnabled: boolean;
  questionReflectionTimeoutMs: number;
  dangerReflectionLevel: DangerReflectionLevel;
  dangerReflectionEnabled: boolean;
  dangerSkipReadOnlyConfirmations: boolean;
  autoContinuationMode: "always" | "blockStop" | "protectedOnly" | "off";
  maxTransientRetries: number;
  silentToolCallThreshold: number;
  behaviorFenceInterval: number;
  tasksReminderInterval: number;
  behaviorFenceAttachTasks: boolean;
  retryBackoffCeilMs: number;
  firstTokenTimeoutMs: number;
  contextThresholds: {
    standard: { pruneStart: number; compactStart: number };
    large: { pruneStart: number; compactStart: number };
  };
  autoCompactKeepPairs: number;
  autoCompactPruneThreshold: number;
  minPruneRatio: number;
  queueDuringCompaction: boolean;
  whitelistDirs: Array<{ path: string; accessLevel?: string; enabled?: boolean }>;
  blacklistDirs: Array<{ path: string; denyLevel?: string; enabled?: boolean }>;
  commandWhitelist: Array<{ pattern: string; enabled?: boolean }>;
  commandBlacklist: Array<{ pattern: string; denyPrompt?: string; enabled?: boolean }>;
  customRetryRules: RuntimeRetryRule[];
}

function bool(record: Record<string, unknown>, key: string, fallback = false) {
  return typeof record[key] === "boolean" ? record[key] as boolean : fallback;
}

function num(record: Record<string, unknown>, key: string, fallback: number) {
  return typeof record[key] === "number" ? record[key] as number : fallback;
}

function draftFromSettings(settings: RuntimeSettings): AgentDraft {
  const agent = asRecord(settings.agent);
  return {
    defaultPermissionMode: (typeof agent.defaultPermissionMode === "string" ? agent.defaultPermissionMode : "default") as RuntimePermissionMode,
    defaultStartInPlanMode: bool(agent, "defaultStartInPlanMode"),
    maxTurns: num(agent, "maxTurns", 1000),
    legacyEncoding: bool(agent, "legacyEncoding"),
    freshShellEnv: bool(agent, "freshShellEnv"),
    translateReasoning: bool(agent, "translateReasoning"),
    requestDumpEnabled: bool(agent, "requestDumpEnabled"),
    requestDumpErrorsOnly: bool(agent, "requestDumpErrorsOnly"),
    defaultRelaxedPlan: bool(agent, "defaultRelaxedPlan"),
    defaultPruneEnabled: bool(agent, "defaultPruneEnabled"),
    planModeAllowInlinePlan: bool(agent, "planModeAllowInlinePlan", true),
    planReflectionAutoApprove: bool(agent, "planReflectionAutoApprove"),
    planReflectionAllowAutoCompact: bool(agent, "planReflectionAllowAutoCompact"),
    questionReflectionEnabled: bool(agent, "questionReflectionEnabled"),
    questionReflectionTimeoutMs: num(agent, "questionReflectionTimeoutMs", 300_000),
    dangerReflectionLevel: (typeof agent.dangerReflectionLevel === "string" ? agent.dangerReflectionLevel : "standard") as DangerReflectionLevel,
    dangerReflectionEnabled: bool(agent, "dangerReflectionEnabled", true),
    dangerSkipReadOnlyConfirmations: bool(agent, "dangerSkipReadOnlyConfirmations"),
    autoContinuationMode: (typeof agent.autoContinuationMode === "string" ? agent.autoContinuationMode : "always") as AgentDraft["autoContinuationMode"],
    maxTransientRetries: num(agent, "maxTransientRetries", 10),
    silentToolCallThreshold: num(agent, "silentToolCallThreshold", 20),
    behaviorFenceInterval: num(agent, "behaviorFenceInterval", -1),
    tasksReminderInterval: num(agent, "tasksReminderInterval", 15),
    behaviorFenceAttachTasks: bool(agent, "behaviorFenceAttachTasks", true),
    retryBackoffCeilMs: num(agent, "retryBackoffCeilMs", 20_000),
    firstTokenTimeoutMs: num(agent, "firstTokenTimeoutMs", 300_000),
    contextThresholds: asRecord(agent.contextThresholds).standard && asRecord(agent.contextThresholds).large
      ? {
          standard: {
            pruneStart: num(asRecord(asRecord(agent.contextThresholds).standard), "pruneStart", 95),
            compactStart: num(asRecord(asRecord(agent.contextThresholds).standard), "compactStart", 99),
          },
          large: {
            pruneStart: num(asRecord(asRecord(agent.contextThresholds).large), "pruneStart", 95),
            compactStart: num(asRecord(asRecord(agent.contextThresholds).large), "compactStart", 99),
          },
        }
      : { standard: { pruneStart: 95, compactStart: 99 }, large: { pruneStart: 95, compactStart: 99 } },
    autoCompactKeepPairs: num(agent, "autoCompactKeepPairs", 2),
    autoCompactPruneThreshold: num(agent, "autoCompactPruneThreshold", 80),
    minPruneRatio: num(agent, "minPruneRatio", 30),
    queueDuringCompaction: bool(agent, "queueDuringCompaction"),
    whitelistDirs: Array.isArray(agent.whitelistDirs) ? agent.whitelistDirs.map((item) => ({ ...asRecord(item) })) as AgentDraft["whitelistDirs"] : [],
    blacklistDirs: Array.isArray(agent.blacklistDirs) ? agent.blacklistDirs.map((item) => ({ ...asRecord(item) })) as AgentDraft["blacklistDirs"] : [],
    commandWhitelist: Array.isArray(agent.commandWhitelist) ? agent.commandWhitelist.map((item) => ({ ...asRecord(item) })) as AgentDraft["commandWhitelist"] : [],
    commandBlacklist: Array.isArray(agent.commandBlacklist) ? agent.commandBlacklist.map((item) => ({ ...asRecord(item) })) as AgentDraft["commandBlacklist"] : [],
    customRetryRules: Array.isArray(agent.customRetryRules)
      ? agent.customRetryRules.map((rule) => ({ ...asRecord(rule) })) as unknown as RuntimeRetryRule[]
      : [],
  };
}

function normalizeInterval(value: number): number {
  if (value < 0) return -1;
  return value < 5 ? 5 : Math.min(1000, Math.trunc(value));
}

function normalizeAccessLevel(value: string | undefined): "readOnly" | "readWrite" | "full" {
  if (value === "full") return "full";
  if (value === "write" || value === "readWrite") return "readWrite";
  return "readOnly";
}

function normalizeDenyLevel(value: string | undefined): "denyWrite" | "denyAll" {
  return value === "write" || value === "denyWrite" ? "denyWrite" : "denyAll";
}

function sanitizedDraft(draft: AgentDraft): AgentDraft {
  return {
    ...draft,
    maxTurns: Math.min(1000, Math.max(1, Math.trunc(draft.maxTurns))),
    questionReflectionTimeoutMs: Math.min(3_600_000, Math.max(10_000, Math.trunc(draft.questionReflectionTimeoutMs))),
    maxTransientRetries: Math.min(100, Math.max(-1, Math.trunc(draft.maxTransientRetries))),
    silentToolCallThreshold: Math.min(1000, Math.max(-1, Math.trunc(draft.silentToolCallThreshold))),
    behaviorFenceInterval: normalizeInterval(draft.behaviorFenceInterval),
    tasksReminderInterval: normalizeInterval(draft.tasksReminderInterval),
    retryBackoffCeilMs: Math.min(300_000, Math.max(1_000, Math.trunc(draft.retryBackoffCeilMs))),
    firstTokenTimeoutMs: Math.min(600_000, Math.max(0, Math.trunc(draft.firstTokenTimeoutMs))),
    autoCompactKeepPairs: Math.min(25, Math.max(1, Math.trunc(draft.autoCompactKeepPairs))),
    autoCompactPruneThreshold: Math.min(100, Math.max(0, Math.trunc(draft.autoCompactPruneThreshold))),
    minPruneRatio: Math.min(100, Math.max(0, Math.trunc(draft.minPruneRatio))),
    planReflectionAllowAutoCompact: draft.planReflectionAutoApprove && draft.planReflectionAllowAutoCompact,
    contextThresholds: {
      standard: {
        pruneStart: Math.min(100, Math.max(50, draft.contextThresholds.standard.pruneStart)),
        compactStart: Math.min(100, Math.max(50, draft.contextThresholds.standard.compactStart)),
      },
      large: {
        pruneStart: Math.min(100, Math.max(10, draft.contextThresholds.large.pruneStart)),
        compactStart: Math.min(100, Math.max(10, draft.contextThresholds.large.compactStart)),
      },
    },
    whitelistDirs: draft.whitelistDirs
      .filter((item) => item.path.trim())
      .map((item) => ({ path: item.path.trim(), accessLevel: normalizeAccessLevel(item.accessLevel), enabled: item.enabled !== false })),
    blacklistDirs: draft.blacklistDirs
      .filter((item) => item.path.trim())
      .map((item) => ({ path: item.path.trim(), denyLevel: normalizeDenyLevel(item.denyLevel), enabled: item.enabled !== false })),
    commandWhitelist: draft.commandWhitelist
      .filter((item) => item.pattern.trim())
      .map((item) => ({ pattern: item.pattern.trim(), enabled: item.enabled !== false })),
    commandBlacklist: draft.commandBlacklist
      .filter((item) => item.pattern.trim())
      .map((item) => ({ pattern: item.pattern.trim(), denyPrompt: item.denyPrompt?.trim() || undefined, enabled: item.enabled !== false })),
  };
}

function ToggleRow({ label, description, checked, disabled, onChange }: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <SettingsSwitchRow
      label={label}
      description={description}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  );
}

export function AgentSettingsPanel() {
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<AgentDraft | null>(null);
  const [preferences, setPreferences] = useState<RuntimeUserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPreference, setSavingPreference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryDraft, setRetryDraft] = useState<AddRetryRuleInput>({});
  const [dumpWarningOpen, setDumpWarningOpen] = useState(false);
  const [expandReasoning, setExpandReasoning] = useLocalBooleanPreference("narrafork_expand_reasoning");

  useEffect(() => {
    let active = true;
    settingsClient.get()
      .then((settings) => {
        if (!active) return;
        const nextDraft = draftFromSettings(settings);
        setDraft(nextDraft);
        setSavedDraft(nextDraft);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    preferencesClient.get()
      .then((nextPreferences) => {
        if (active) setPreferences(nextPreferences);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, []);

  async function savePreference<K extends keyof UserPreferencesPatch>(key: K, value: UserPreferencesPatch[K]) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [key]: value });
    setSavingPreference(String(key));
    setError(null);
    try {
      setPreferences(await preferencesClient.patch({ [key]: value } as UserPreferencesPatch));
    } catch (reason) {
      setPreferences(previous);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingPreference(null);
    }
  }

  async function handleSave() {
    if (!draft) return;
    const next = sanitizedDraft(draft);
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsClient.patch({
        agent: {
          defaultPermissionMode: next.defaultPermissionMode,
          defaultStartInPlanMode: next.defaultStartInPlanMode,
          maxTurns: next.maxTurns,
          legacyEncoding: next.legacyEncoding,
          freshShellEnv: next.freshShellEnv,
          translateReasoning: next.translateReasoning,
          requestDumpEnabled: next.requestDumpEnabled,
          requestDumpErrorsOnly: next.requestDumpErrorsOnly,
          defaultRelaxedPlan: next.defaultRelaxedPlan,
          defaultPruneEnabled: next.defaultPruneEnabled,
          planModeAllowInlinePlan: next.planModeAllowInlinePlan,
          planReflectionAutoApprove: next.planReflectionAutoApprove,
          planReflectionAllowAutoCompact: next.planReflectionAllowAutoCompact,
          questionReflectionEnabled: next.questionReflectionEnabled,
          questionReflectionTimeoutMs: next.questionReflectionTimeoutMs,
          dangerReflectionLevel: next.dangerReflectionLevel,
          dangerReflectionEnabled: next.dangerReflectionEnabled,
          dangerSkipReadOnlyConfirmations: next.dangerSkipReadOnlyConfirmations,
          autoContinuationMode: next.autoContinuationMode,
          maxTransientRetries: next.maxTransientRetries,
          silentToolCallThreshold: next.silentToolCallThreshold,
          behaviorFenceInterval: next.behaviorFenceInterval,
          tasksReminderInterval: next.tasksReminderInterval,
          behaviorFenceAttachTasks: next.behaviorFenceAttachTasks,
          retryBackoffCeilMs: next.retryBackoffCeilMs,
          firstTokenTimeoutMs: next.firstTokenTimeoutMs,
          contextThresholds: next.contextThresholds,
          autoCompactKeepPairs: next.autoCompactKeepPairs,
          autoCompactPruneThreshold: next.autoCompactPruneThreshold,
          minPruneRatio: next.minPruneRatio,
          queueDuringCompaction: next.queueDuringCompaction,
          whitelistDirs: next.whitelistDirs,
          blacklistDirs: next.blacklistDirs,
          commandWhitelist: next.commandWhitelist,
          commandBlacklist: next.commandBlacklist,
          customRetryRules: next.customRetryRules,
        },
      });
      const saved = draftFromSettings(updated);
      setDraft(saved);
      setSavedDraft(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function addRetryRule() {
    if (!draft || (!retryDraft.domain && !retryDraft.statusCode && !retryDraft.keyword)) return;
    setSaving(true);
    setError(null);
    try {
      const rule = await settingsClient.addRetryRule(retryDraft);
      setDraft({ ...draft, customRetryRules: [...draft.customRetryRules, rule] });
      setRetryDraft({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取 Agent 配置…</p>;
  if (!draft) return <p className="py-8 text-center text-sm text-destructive">Agent 配置加载失败。</p>;

  const dirty = Boolean(savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft));

  return (
    <SettingsPage
      title="AI 代理"
      description="配置工作助手的权限、计划、上下文和运行行为。"
    >
      {error ? <Alert><AlertTitle>Agent 设置操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <SettingsGroup title="基础运行" description="设置默认权限、运行轮次和请求记录方式。">
        <div className="flex flex-col gap-4">
          <label className="grid gap-2 text-sm sm:grid-cols-[1fr_260px] sm:items-center">
            <span className="font-medium">默认权限模式</span>
            <SimpleSelect
              aria-label="默认权限模式"
              value={draft.defaultPermissionMode}
              onValueChange={(value) => setDraft({ ...draft, defaultPermissionMode: value as RuntimePermissionMode })}
              options={[
                { value: "default", label: "default · 默认询问" },
                { value: "acceptEdits", label: "acceptEdits · 接受编辑" },
                { value: "bypassPermissions", label: "bypassPermissions · 绕过权限" },
                { value: "readOnly", label: "readOnly · 只读" },
                { value: "dontAsk", label: "dontAsk · 不询问" },
              ]}
            />
          </label>
          <label className="grid gap-2 text-sm sm:grid-cols-[1fr_180px] sm:items-center">
            <span>
              <span className="font-medium">最大轮次</span>
              <span className="block text-xs text-muted-foreground">每次 Agent 运行最多 1–1000 轮。</span>
            </span>
            <Input aria-label="Agent 最大轮次" type="number" min={1} max={1000} value={draft.maxTurns} onChange={(event) => setDraft({ ...draft, maxTurns: Math.min(1000, Math.max(1, Number(event.currentTarget.value) || 1)) })} />
          </label>
          <ToggleRow label="默认进入计划模式" description="新叙述者创建时启用 plan trait。" checked={draft.defaultStartInPlanMode} onChange={(value) => setDraft({ ...draft, defaultStartInPlanMode: value })} />
          <ToggleRow label="旧编码支持" description="读取和写入时检测 GBK、Shift_JIS 等非 UTF-8 编码。" checked={draft.legacyEncoding} onChange={(value) => setDraft({ ...draft, legacyEncoding: value })} />
          <ToggleRow label="刷新 Shell 环境" description="Bash 工具使用 login shell 读取最新环境变量。" checked={draft.freshShellEnv} onChange={(value) => setDraft({ ...draft, freshShellEnv: value })} />
          <ToggleRow label="翻译推理内容" description="通过摘要模型将推理块翻译为用户语言。" checked={draft.translateReasoning} onChange={(value) => setDraft({ ...draft, translateReasoning: value })} />
          <ToggleRow label="记录原始请求" description="将供应商原始请求与响应写入使用记录，可能包含敏感内容。" checked={draft.requestDumpEnabled} onChange={(value) => {
            if (value && !draft.requestDumpEnabled) setDumpWarningOpen(true);
            else setDraft({ ...draft, requestDumpEnabled: value, requestDumpErrorsOnly: value ? draft.requestDumpErrorsOnly : false });
          }} />
          <ToggleRow label="仅记录失败请求" description="启用原始请求记录时，只持久化失败调用。" checked={draft.requestDumpErrorsOnly} disabled={!draft.requestDumpEnabled} onChange={(value) => setDraft({ ...draft, requestDumpErrorsOnly: value })} />
          <ToggleRow label="默认展开推理内容" description="打开会话时默认展开模型推理内容。" checked={expandReasoning} onChange={setExpandReasoning} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="计划与危险反思" description="控制计划模式、上下文裁剪和高风险操作确认。">
        <div className="flex flex-col gap-4">
          <ToggleRow label="默认宽松计划" description="新叙述者的计划模式默认允许更多工具。" checked={draft.defaultRelaxedPlan} onChange={(value) => setDraft({ ...draft, defaultRelaxedPlan: value })} />
          <ToggleRow label="默认启用上下文裁剪" description="新叙述者会自动裁剪低价值上下文。" checked={draft.defaultPruneEnabled} onChange={(value) => setDraft({ ...draft, defaultPruneEnabled: value })} />
          <ToggleRow label="允许内联计划" description="ExitPlanMode 可直接提交 inline_plan。" checked={draft.planModeAllowInlinePlan} onChange={(value) => setDraft({ ...draft, planModeAllowInlinePlan: value })} />
          <ToggleRow label="计划反思自动批准" description="在可编辑权限模式中，计划反思可自动批准。" checked={draft.planReflectionAutoApprove} onChange={(value) => setDraft({ ...draft, planReflectionAutoApprove: value })} />
          <ToggleRow label="计划反思允许自动 Compact" description="计划反思需要压缩上下文时可自动执行 Compact。" checked={draft.planReflectionAllowAutoCompact} disabled={!draft.planReflectionAutoApprove} onChange={(value) => setDraft({ ...draft, planReflectionAllowAutoCompact: value })} />
          <ToggleRow label="问题反思" description="AskUserQuestion 可在超时前请求 Agent 自行反思回答。" checked={draft.questionReflectionEnabled} onChange={(value) => setDraft({ ...draft, questionReflectionEnabled: value })} />
          <NumberField label="问题反思超时（秒）" value={Math.round(draft.questionReflectionTimeoutMs / 1000)} min={10} max={3600} onChange={(value) => setDraft({ ...draft, questionReflectionTimeoutMs: value * 1000 })} />
          <label className="grid gap-2 text-sm sm:grid-cols-[1fr_220px] sm:items-center">
            <span className="font-medium">危险反思级别</span>
            <SimpleSelect aria-label="危险反思级别" value={draft.dangerReflectionLevel} onValueChange={(value) => setDraft({ ...draft, dangerReflectionLevel: value as DangerReflectionLevel, dangerReflectionEnabled: value !== "off" })} options={[
              { value: "off", label: "关闭" },
              { value: "light", label: "轻量" },
              { value: "standard", label: "标准" },
              { value: "strict", label: "严格" },
            ]} />
          </label>
          <ToggleRow label="启用危险反思" description="绕过权限模式下对高风险操作执行二次确认。" checked={draft.dangerReflectionEnabled} onChange={(value) => setDraft({ ...draft, dangerReflectionEnabled: value, dangerReflectionLevel: value ? (draft.dangerReflectionLevel === "off" ? "standard" : draft.dangerReflectionLevel) : "off" })} />
          <ToggleRow label="跳过只读危险确认" description="已确认只读的操作不触发额外安全暂停。" checked={draft.dangerSkipReadOnlyConfirmations} onChange={(value) => setDraft({ ...draft, dangerSkipReadOnlyConfirmations: value })} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="自动续跑与系统提醒" description="配置任务续跑、行为围栏和提醒频率。">
        <div className="flex flex-col gap-4">
          <label className="grid gap-2 text-sm sm:grid-cols-[1fr_240px] sm:items-center">
            <span className="font-medium">自动续跑模式</span>
            <SimpleSelect aria-label="自动续跑模式" value={draft.autoContinuationMode} onValueChange={(value) => setDraft({ ...draft, autoContinuationMode: value as AgentDraft["autoContinuationMode"] })} options={[
              { value: "always", label: "始终续跑" },
              { value: "blockStop", label: "阻塞停止时续跑" },
              { value: "protectedOnly", label: "仅受保护任务" },
              { value: "off", label: "关闭" },
            ]} />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="静默工具调用阈值" value={draft.silentToolCallThreshold} min={-1} max={1000} onChange={(value) => setDraft({ ...draft, silentToolCallThreshold: value })} />
            <NumberField label="行为围栏间隔" value={draft.behaviorFenceInterval} min={-1} max={1000} onChange={(value) => setDraft({ ...draft, behaviorFenceInterval: value })} />
            <NumberField label="任务提醒间隔" value={draft.tasksReminderInterval} min={-1} max={1000} onChange={(value) => setDraft({ ...draft, tasksReminderInterval: value })} />
          </div>
          <ToggleRow label="行为围栏附带任务" description="注入行为围栏时同时附带当前 Dynamic Spec 任务。" checked={draft.behaviorFenceAttachTasks} onChange={(value) => setDraft({ ...draft, behaviorFenceAttachTasks: value })} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="上下文裁剪与 Compact" description="调整上下文阈值、保留消息数量和 Compact 排队策略。">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField label="标准上下文开始裁剪（%）" value={draft.contextThresholds.standard.pruneStart} min={50} max={100} onChange={(value) => setDraft({ ...draft, contextThresholds: { ...draft.contextThresholds, standard: { ...draft.contextThresholds.standard, pruneStart: value } } })} />
            <NumberField label="标准上下文开始 Compact（%）" value={draft.contextThresholds.standard.compactStart} min={50} max={100} onChange={(value) => setDraft({ ...draft, contextThresholds: { ...draft.contextThresholds, standard: { ...draft.contextThresholds.standard, compactStart: value } } })} />
            <NumberField label="大上下文开始裁剪（%）" value={draft.contextThresholds.large.pruneStart} min={10} max={100} onChange={(value) => setDraft({ ...draft, contextThresholds: { ...draft.contextThresholds, large: { ...draft.contextThresholds.large, pruneStart: value } } })} />
            <NumberField label="大上下文开始 Compact（%）" value={draft.contextThresholds.large.compactStart} min={10} max={100} onChange={(value) => setDraft({ ...draft, contextThresholds: { ...draft.contextThresholds, large: { ...draft.contextThresholds.large, compactStart: value } } })} />
            <NumberField label="自动 Compact 保留消息对" value={draft.autoCompactKeepPairs} min={1} max={25} onChange={(value) => setDraft({ ...draft, autoCompactKeepPairs: value })} />
            <NumberField label="自动 Compact 裁剪阈值（%）" value={draft.autoCompactPruneThreshold} min={0} max={100} onChange={(value) => setDraft({ ...draft, autoCompactPruneThreshold: value })} />
            <NumberField label="最小裁剪比例（%）" value={draft.minPruneRatio} min={0} max={100} onChange={(value) => setDraft({ ...draft, minPruneRatio: value })} />
          </div>
          <ToggleRow label="Compact 期间允许消息排队" description="Compact 执行期间将新消息加入队列，而不是立即拒绝。" checked={draft.queueDuringCompaction} onChange={(value) => setDraft({ ...draft, queueDuringCompaction: value })} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="全局目录与命令规则" description="设置工作助手可访问的目录和可执行的命令。">
        <div className="grid gap-6 lg:grid-cols-2">
          <PathRuleEditor title="目录白名单" items={draft.whitelistDirs} mode="allow" onChange={(items) => setDraft({ ...draft, whitelistDirs: items })} />
          <PathRuleEditor title="目录黑名单" items={draft.blacklistDirs} mode="deny" onChange={(items) => setDraft({ ...draft, blacklistDirs: items })} />
          <CommandRuleEditor title="命令白名单" items={draft.commandWhitelist} mode="allow" onChange={(items) => setDraft({ ...draft, commandWhitelist: items })} />
          <CommandRuleEditor title="命令黑名单" items={draft.commandBlacklist} mode="deny" onChange={(items) => setDraft({ ...draft, commandBlacklist: items })} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="重试与超时" description="设置可恢复错误的重试次数、退避上限和首 Token 超时。">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="最大瞬时重试" value={draft.maxTransientRetries} min={-1} max={100} onChange={(value) => setDraft({ ...draft, maxTransientRetries: value })} />
          <NumberField label="退避上限（秒）" value={Math.round(draft.retryBackoffCeilMs / 1000)} min={1} max={300} onChange={(value) => setDraft({ ...draft, retryBackoffCeilMs: value * 1000 })} />
          <NumberField label="首 Token 超时（秒）" value={Math.round(draft.firstTokenTimeoutMs / 1000)} min={0} max={600} onChange={(value) => setDraft({ ...draft, firstTokenTimeoutMs: value * 1000 })} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="自定义可重试错误" description="添加可恢复错误的匹配规则，并在保存设置时一起生效。">
        <div className="flex flex-col gap-4">
          {draft.customRetryRules.map((rule, index) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Switch aria-label={`启用重试规则 ${rule.id}`} checked={rule.enabled !== false} onCheckedChange={(value) => {
                const rules = [...draft.customRetryRules];
                rules[index] = { ...rule, enabled: value };
                setDraft({ ...draft, customRetryRules: rules });
              }} />
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                <p className="font-mono text-foreground">{rule.domain || "任意域名"} · {rule.statusCode || "任意状态码"} · {rule.keyword || "任意关键词"}</p>
                {rule.note ? <p>{rule.note}</p> : null}
              </div>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除重试规则 ${rule.id}`} onClick={() => setDraft({ ...draft, customRetryRules: draft.customRetryRules.filter((candidate) => candidate.id !== rule.id) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-4">
            <Input aria-label="重试规则域名" placeholder="域名关键词" value={retryDraft.domain ?? ""} onChange={(event) => setRetryDraft({ ...retryDraft, domain: event.currentTarget.value || undefined })} />
            <Input aria-label="重试规则状态码" type="number" min={100} max={599} placeholder="状态码" value={retryDraft.statusCode ?? ""} onChange={(event) => setRetryDraft({ ...retryDraft, statusCode: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })} />
            <Input aria-label="重试规则关键词" placeholder="错误关键词" value={retryDraft.keyword ?? ""} onChange={(event) => setRetryDraft({ ...retryDraft, keyword: event.currentTarget.value || undefined })} />
            <Input aria-label="重试规则备注" placeholder="备注" value={retryDraft.note ?? ""} onChange={(event) => setRetryDraft({ ...retryDraft, note: event.currentTarget.value || undefined })} />
          </div>
          <Button type="button" variant="outline" onClick={addRetryRule} disabled={saving || (!retryDraft.domain && !retryDraft.statusCode && !retryDraft.keyword)}>
            <Plus data-icon="inline-start" />
            创建重试规则
          </Button>
        </div>
      </SettingsGroup>

      {preferences ? (
        <SettingsGroup title="会话与输出" description="配置消息加载、语言、Token 用量和输出统计显示。">
          <ToggleRow label="自动加载更早消息" description="滚动到会话顶部时自动读取更早的消息。" checked={preferences.autoLoadOlderMessages} onChange={(value) => void savePreference("autoLoadOlderMessages", value)} />
          <ToggleRow label="按用户语言回复" description="要求 Agent 尽量使用用户当前语言回复。" checked={preferences.replyInUserLanguage} onChange={(value) => void savePreference("replyInUserLanguage", value)} />
          <ToggleRow label="显示 Token 用量" description="在回复后展示输入和输出 Token。" checked={preferences.showTokenUsage} onChange={(value) => void savePreference("showTokenUsage", value)} />
          <ToggleRow label="显示输出统计" description="显示输出速度和相关运行统计。" checked={preferences.showOutputStats} onChange={(value) => void savePreference("showOutputStats", value)} />
          {savingPreference ? <p className="text-xs text-muted-foreground">正在保存 {savingPreference}…</p> : null}
        </SettingsGroup>
      ) : null}

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="保存 Agent 设置"
        onDiscard={() => { if (savedDraft) setDraft(savedDraft); }}
        onSave={() => void handleSave()}
      />

      <Dialog open={dumpWarningOpen} onOpenChange={setDumpWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>开启原始请求转储？</DialogTitle>
            <DialogDescription>
              原始请求与响应可能包含提示词、小说正文和供应商凭据。仅在排查问题时开启，并优先使用“仅记录失败请求”。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDumpWarningOpen(false)}>取消</Button>
            <Button type="button" onClick={() => {
              setDraft({ ...draft, requestDumpEnabled: true });
              setDumpWarningOpen(false);
            }}>确认开启</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}

function PathRuleEditor({
  title,
  items,
  mode,
  onChange,
}: {
  title: string;
  items: Array<{ path: string; accessLevel?: string; denyLevel?: string; enabled?: boolean }>;
  mode: "allow" | "deny";
  onChange: (items: Array<{ path: string; accessLevel?: string; denyLevel?: string; enabled?: boolean }>) => void;
}) {
  const update = (index: number, patch: Record<string, string | boolean>) =>
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, mode === "allow" ? { path: "", accessLevel: "readOnly", enabled: true } : { path: "", denyLevel: "denyAll", enabled: true }])}>添加规则</Button>
      </div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">暂无规则</p> : items.map((item, index) => (
        <div key={`${title}-${index}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto]">
          <Input aria-label={`${title}路径 ${index + 1}`} value={item.path} placeholder="绝对路径或 glob" onChange={(event) => update(index, { path: event.target.value })} />
          <SimpleSelect
            aria-label={`${title}级别 ${index + 1}`}
            value={mode === "allow" ? normalizeAccessLevel(item.accessLevel) : normalizeDenyLevel(item.denyLevel)}
            onValueChange={(value) => update(index, mode === "allow" ? { accessLevel: value } : { denyLevel: value })}
            options={mode === "allow"
              ? [{ value: "readOnly", label: "只读" }, { value: "readWrite", label: "读写" }, { value: "full", label: "完整访问" }]
              : [{ value: "denyAll", label: "全部拒绝" }, { value: "denyWrite", label: "仅拒绝写入" }]}
          />
          <Switch aria-label={`${title}启用 ${index + 1}`} checked={item.enabled !== false} onCheckedChange={(value) => update(index, { enabled: value })} />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
        </div>
      ))}
    </div>
  );
}

function CommandRuleEditor({
  title,
  items,
  mode,
  onChange,
}: {
  title: string;
  items: Array<{ pattern: string; denyPrompt?: string; enabled?: boolean }>;
  mode: "allow" | "deny";
  onChange: (items: Array<{ pattern: string; denyPrompt?: string; enabled?: boolean }>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { pattern: "", ...(mode === "deny" ? { denyPrompt: "" } : {}), enabled: true }])}>添加规则</Button>
      </div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">暂无规则</p> : items.map((item, index) => (
        <div key={`${title}-${index}`} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input aria-label={`${title}模式 ${index + 1}`} value={item.pattern} placeholder="命令或正则模式" onChange={(event) => onChange(items.map((current, itemIndex) => itemIndex === index ? { ...current, pattern: event.target.value } : current))} />
            <Switch aria-label={`${title}启用 ${index + 1}`} checked={item.enabled !== false} onCheckedChange={(value) => onChange(items.map((current, itemIndex) => itemIndex === index ? { ...current, enabled: value } : current))} />
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
          </div>
          {mode === "deny" ? <Input aria-label={`${title}提示 ${index + 1}`} value={item.denyPrompt ?? ""} placeholder="拒绝原因（可选）" onChange={(event) => onChange(items.map((current, itemIndex) => itemIndex === index ? { ...current, denyPrompt: event.target.value } : current))} /> : null}
        </div>
      ))}
    </div>
  );
}

function NumberField({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  const inputId = `agent-number-${label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")}`;
  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.currentTarget.value) || 0)))}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
