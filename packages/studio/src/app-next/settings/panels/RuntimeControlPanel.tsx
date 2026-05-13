import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { fetchJson, putApi } from "@/hooks/use-api";
import { PROXY_API_PATH, USER_SETTINGS_API_PATH, createLenientFetchJsonContractClient, createProviderClient } from "@/app-next/backend-contract";
import { runtimeModelLabel, usableRuntimeModels, type RuntimeModelOption } from "@/lib/runtime-model-options";
import { SESSION_PERMISSION_MODE_OPTIONS } from "@/shared/session-types";
import type { ModelDefaultSettings, ProxySettings, RuntimeControlSettings, UserConfig } from "@/types/settings";
import { DEFAULT_USER_CONFIG } from "@/types/settings";
import { deriveAgentRuntimeSettingsFacts, settingsFactDisplayValue, settingsFactStatusLabel, type SettingsFact } from "../SettingsTruthModel";

// ---------------------------------------------------------------------------
// Extended runtime controls — all switches now in core RuntimeControlSettings
// ---------------------------------------------------------------------------

type ExtendedRuntimeControls = RuntimeControlSettings;

// ---------------------------------------------------------------------------
// Option definitions
// ---------------------------------------------------------------------------

const PERMISSION_OPTIONS: Array<{
  value: RuntimeControlSettings["defaultPermissionMode"];
  label: string;
}> = SESSION_PERMISSION_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

const REASONING_OPTIONS: Array<{
  value: RuntimeControlSettings["defaultReasoningEffort"];
  label: string;
}> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const ARC_TRACKING_OPTIONS: Array<{
  value: NonNullable<RuntimeControlSettings["arcTrackingMode"]>;
  label: string;
}> = [
  { value: "off", label: "关闭" },
  { value: "rule", label: "规则引擎" },
  { value: "llm", label: "LLM 精炼" },
];

const MCP_POLICY_OPTIONS: Array<{
  value: RuntimeControlSettings["toolAccess"]["mcpStrategy"];
  label: string;
}> = [
  { value: "inherit", label: "继承默认权限" },
  { value: "allow", label: "直接允许" },
  { value: "ask", label: "执行前确认" },
  { value: "deny", label: "默认拒绝" },
];

const DEFAULT_RUNTIME_CONTROLS = DEFAULT_USER_CONFIG.runtimeControls;
const DEFAULT_MODEL_DEFAULTS = DEFAULT_USER_CONFIG.modelDefaults;
const DEFAULT_PROXY_SETTINGS = DEFAULT_USER_CONFIG.proxy;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNumInput(raw: string, fallback: number, min: number, max: number) {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clampNumber(n, min, max) : fallback;
}

// ---------------------------------------------------------------------------
// Tiny layout primitives
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function RuntimeFactRow({ fact }: { readonly fact: SettingsFact<unknown> }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs" data-setting-fact-id={fact.id}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{fact.label}</span>
        <span className="font-mono text-foreground">{settingsFactDisplayValue(fact)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>状态：{settingsFactStatusLabel(fact.status)}</span>
        {fact.readApi && <span>读取：{fact.readApi}</span>}
        {fact.writeApi && <span>写入：{fact.writeApi}</span>}
        {fact.reason && <span>{settingsFactStatusLabel(fact.status)}：{fact.reason}</span>}
      </div>
    </div>
  );
}

function RuntimeFactsSummary({ facts }: { readonly facts: ReadonlyArray<SettingsFact<unknown>> }) {
  const userSettingsFact = facts.find((fact) => fact.readApi === USER_SETTINGS_API_PATH);
  const proxyFact = facts.find((fact) => fact.readApi === PROXY_API_PATH);
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {userSettingsFact?.readApi && <span>来源：{userSettingsFact.readApi}</span>}
      {proxyFact?.readApi && <span className="ml-3">代理来源：{proxyFact.readApi}</span>}
    </div>
  );
}

const wideInputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors";

// ---------------------------------------------------------------------------
// ListManager (simplified)
// ---------------------------------------------------------------------------

function ListManager({
  items,
  onChange,
}: {
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          className="flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="输入路径或命令"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (draft.trim()) {
              onChange([...items, draft.trim()]);
              setDraft("");
            }
          }}
        >
          添加
        </Button>
      </div>
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-sm">
              <span className="font-mono">{item}</span>
              <Button
                variant="ghost"
                size="xs"
                className="text-xs text-destructive hover:underline"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                type="button"
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">暂无配置</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function RuntimeControlPanel() {
  const [rc, setRc] = useState<ExtendedRuntimeControls>(DEFAULT_RUNTIME_CONTROLS);
  const [md, setMd] = useState<ModelDefaultSettings>(DEFAULT_MODEL_DEFAULTS);
  const [proxy, setProxy] = useState<ProxySettings>(DEFAULT_PROXY_SETTINGS);
  const [modelOptions, setModelOptions] = useState<RuntimeModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  function applyUserConfig(data: Pick<UserConfig, "runtimeControls" | "modelDefaults" | "proxy">) {
    setRc({ ...DEFAULT_RUNTIME_CONTROLS, ...(data.runtimeControls ?? {}) });
    setMd({
      ...DEFAULT_MODEL_DEFAULTS,
      ...(data.modelDefaults ?? {}),
      subagentModelPool: data.modelDefaults?.subagentModelPool ?? DEFAULT_MODEL_DEFAULTS.subagentModelPool,
    });
    setProxy({ ...DEFAULT_PROXY_SETTINGS, ...(data.proxy ?? {}) });
    setIsDirty(false);
  }

  async function refetchUserConfig() {
    const data = await fetchJson<Pick<UserConfig, "runtimeControls" | "modelDefaults" | "proxy">>(USER_SETTINGS_API_PATH);
    applyUserConfig(data);
    return data;
  }

  // --- data loading ---
  useEffect(() => {
    let cancelled = false;

    refetchUserConfig()
      .then(() => {
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void createProviderClient(createLenientFetchJsonContractClient(fetchJson)).listModels<{ models?: RuntimeModelOption[] }>()
      .then((result) => {
        if (!cancelled) {
          setModelOptions(usableRuntimeModels(result.ok ? result.data.models : []));
        }
      })
      .catch(() => {
        if (!cancelled) setModelOptions([]);
      });

    return () => { cancelled = true; };
  }, []);

  // --- save ---
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await putApi<UserConfig>(USER_SETTINGS_API_PATH, { runtimeControls: rc, modelDefaults: md });
      await putApi<ProxySettings>(PROXY_API_PATH, proxy);
      await refetchUserConfig();
      setSaved(true);
      setIsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // --- shorthand updaters ---
  const dirty = () => { setSaved(false); setIsDirty(true); };
  const patchRc = (patch: Partial<ExtendedRuntimeControls>) => { dirty(); setRc((c) => ({ ...c, ...patch })); };
  const patchMd = (patch: Partial<ModelDefaultSettings>) => { dirty(); setMd((c) => ({ ...c, ...patch })); };
  const patchProxy = (patch: Partial<ProxySettings>) => { dirty(); setProxy((c) => ({ ...c, ...patch })); };
  const patchToolAccess = (patch: Partial<RuntimeControlSettings["toolAccess"]>) => {
    dirty();
    setRc((c) => ({ ...c, toolAccess: { ...c.toolAccess, ...patch } }));
  };
  const patchDebug = (patch: Partial<RuntimeControlSettings["runtimeDebug"]>) => {
    dirty();
    setRc((c) => ({ ...c, runtimeDebug: { ...c.runtimeDebug, ...patch } }));
  };
  const hasModelOptions = modelOptions.length > 0;
  const runtimeFacts = useMemo(
    () => deriveAgentRuntimeSettingsFacts({ runtimeControls: rc, modelDefaults: md, proxy }),
    [md, proxy, rc],
  );

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">正在读取运行控制配置…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* ---- 权限与推理 ---- */}
      <Section title="权限与推理">
        <FieldRow label="默认权限模式">
          <SimpleSelect
            value={rc.defaultPermissionMode}
            onValueChange={(val) => patchRc({ defaultPermissionMode: val as RuntimeControlSettings["defaultPermissionMode"] })}
            options={PERMISSION_OPTIONS}
            aria-label="默认权限模式"
          />
        </FieldRow>
        <FieldRow label="默认推理强度">
          <SimpleSelect
            value={rc.defaultReasoningEffort}
            onValueChange={(val) => patchRc({ defaultReasoningEffort: val as RuntimeControlSettings["defaultReasoningEffort"] })}
            options={REASONING_OPTIONS}
            aria-label="默认推理强度"
          />
        </FieldRow>
        <FieldRow label="每条消息最大轮次">
          <Input
            className="w-32 text-right"
            type="number"
            min={1}
            max={1000}
            value={rc.maxTurnSteps}
            onChange={(e) => patchRc({ maxTurnSteps: parseNumInput(e.target.value, rc.maxTurnSteps, 1, 1000) })}
          />
        </FieldRow>
      </Section>

      {/* ---- 模型 ---- */}
      <Section title="模型">
        {hasModelOptions ? (
          <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            默认会话模型{md.defaultSessionModel ? "已从用户设置读取" : "未配置，请选择模型池中的可用模型"}
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            尚未配置可用模型
          </p>
        )}
        <FieldRow label="默认会话模型">
          <SimpleSelect
            aria-label="默认会话模型"
            className="w-full"
            value={md.defaultSessionModel}
            disabled={!hasModelOptions}
            onValueChange={(val) => patchMd({ defaultSessionModel: val })}
            options={modelOptions.map((model) => ({ value: model.modelId, label: `${runtimeModelLabel(model)}（会话）` }))}
            placeholder="请选择模型"
          />
        </FieldRow>
        <FieldRow label="摘要模型">
          <SimpleSelect
            aria-label="摘要模型"
            className="w-full"
            value={md.summaryModel}
            disabled={!hasModelOptions}
            onValueChange={(val) => patchMd({ summaryModel: val })}
            options={modelOptions.map((model) => ({ value: model.modelId, label: `${runtimeModelLabel(model)}（摘要）` }))}
            placeholder="请选择模型"
          />
        </FieldRow>
        <FieldRow label="Explore 子代理模型">
          <SimpleSelect
            aria-label="Explore 子代理模型"
            className="w-full"
            value={md.exploreSubagentModel}
            disabled={!hasModelOptions}
            onValueChange={(val) => patchMd({ exploreSubagentModel: val })}
            options={modelOptions.map((model) => ({ value: model.modelId, label: `${runtimeModelLabel(model)}（Explore）` }))}
            placeholder="请选择模型"
          />
        </FieldRow>
        <FieldRow label="Plan 子代理模型">
          <SimpleSelect
            aria-label="Plan 子代理模型"
            className="w-full"
            value={md.planSubagentModel}
            disabled={!hasModelOptions}
            onValueChange={(val) => patchMd({ planSubagentModel: val })}
            options={modelOptions.map((model) => ({ value: model.modelId, label: `${runtimeModelLabel(model)}（Plan）` }))}
            placeholder="请选择模型"
          />
        </FieldRow>
        <FieldRow label="General 子代理模型">
          <SimpleSelect
            aria-label="General 子代理模型"
            className="w-full"
            value={md.generalSubagentModel}
            disabled={!hasModelOptions}
            onValueChange={(val) => patchMd({ generalSubagentModel: val })}
            options={modelOptions.map((model) => ({ value: model.modelId, label: `${runtimeModelLabel(model)}（General）` }))}
            placeholder="请选择模型"
          />
        </FieldRow>
        <FieldRow label="Codex 推理强度">
          <SimpleSelect
            aria-label="Codex 推理强度"
            value={md.codexReasoningEffort}
            onValueChange={(val) => patchMd({ codexReasoningEffort: val as ModelDefaultSettings["codexReasoningEffort"] })}
            options={REASONING_OPTIONS}
          />
        </FieldRow>
        <FieldRow label="子代理模型池">
          <div className="space-y-2 w-full max-w-xs">
            {md.subagentModelPool.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {md.subagentModelPool.map((modelId) => {
                  const model = modelOptions.find((m) => m.modelId === modelId);
                  return (
                    <span key={modelId} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs">
                      {model ? runtimeModelLabel(model) : modelId}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => patchMd({ subagentModelPool: md.subagentModelPool.filter((id) => id !== modelId) })}
                        aria-label={`移除 ${modelId}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {hasModelOptions && (
              <SimpleSelect
                value=""
                onValueChange={(val) => {
                  if (val && !md.subagentModelPool.includes(val)) {
                    patchMd({ subagentModelPool: [...md.subagentModelPool, val] });
                  }
                }}
                options={modelOptions
                  .filter((m) => !md.subagentModelPool.includes(m.modelId))
                  .map((model) => ({ value: model.modelId, label: runtimeModelLabel(model) }))}
                aria-label="添加模型到子代理池"
                className="w-full"
              />
            )}
            {!hasModelOptions && (
              <p className="text-xs text-muted-foreground">无可用模型，请先配置供应商。</p>
            )}
          </div>
        </FieldRow>
      </Section>

      {/* ---- 行为 ---- */}
      <Section title="行为">
        <FieldRow label="角色弧线追踪">
          <SimpleSelect
            value={rc.arcTrackingMode ?? "rule"}
            onValueChange={(val) => patchRc({ arcTrackingMode: val as NonNullable<RuntimeControlSettings["arcTrackingMode"]> })}
            options={ARC_TRACKING_OPTIONS}
            aria-label="角色弧线追踪模式"
          />
        </FieldRow>
        <FieldRow label="翻译思考内容"><Switch checked={rc.translateThinking ?? false} onCheckedChange={(v) => patchRc({ translateThinking: v })} /></FieldRow>
        <FieldRow label="默认展开推理内容"><Switch checked={rc.expandReasoning ?? false} onCheckedChange={(v) => patchRc({ expandReasoning: v })} /></FieldRow>
        <FieldRow label="默认宽松规划"><Switch checked={rc.relaxedPlanning ?? true} onCheckedChange={(v) => patchRc({ relaxedPlanning: v })} /></FieldRow>
        <FieldRow label="智能检查输出中断"><Switch checked={rc.smartOutputCheck ?? true} onCheckedChange={(v) => patchRc({ smartOutputCheck: v })} /></FieldRow>
        <FieldRow label="要求使用您的语言回复"><Switch checked={rc.forceUserLanguage ?? false} onCheckedChange={(v) => patchRc({ forceUserLanguage: v })} /></FieldRow>
        <FieldRow label="跳过只读危险反思确认"><Switch checked={rc.yoloSkipReadonlyConfirmation ?? false} onCheckedChange={(v) => patchRc({ yoloSkipReadonlyConfirmation: v })} /></FieldRow>
        <FieldRow label="显示 Token 用量"><Switch checked={rc.showTokenUsage ?? false} onCheckedChange={(v) => patchRc({ showTokenUsage: v })} /></FieldRow>
        <FieldRow label="显示实时输出速率"><Switch checked={rc.showOutputRate ?? false} onCheckedChange={(v) => patchRc({ showOutputRate: v })} /></FieldRow>
        <FieldRow label="滚动自动加载历史"><Switch checked={rc.scrollAutoLoadHistory ?? true} onCheckedChange={(v) => patchRc({ scrollAutoLoadHistory: v })} /></FieldRow>
        <FieldRow label="发送方式">
          <SimpleSelect
            value={rc.sendMode ?? "enter"}
            onValueChange={(val) => patchRc({ sendMode: val as "enter" | "ctrl-enter" })}
            options={[
              { value: "enter", label: "Enter 发送" },
              { value: "ctrl-enter", label: "Ctrl+Enter 发送" },
            ]}
            aria-label="发送方式"
          />
        </FieldRow>
      </Section>

      {/* ---- MCP 策略 ---- */}
      <Section title="MCP 策略">
        <FieldRow label="MCP 工具策略">
          <SimpleSelect
            value={rc.toolAccess.mcpStrategy}
            onValueChange={(val) => patchToolAccess({ mcpStrategy: val as RuntimeControlSettings["toolAccess"]["mcpStrategy"] })}
            options={MCP_POLICY_OPTIONS}
            aria-label="MCP 工具策略"
          />
        </FieldRow>
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">允许工具列表</span>
          <ListManager items={rc.toolAccess.allowlist} onChange={(items) => patchToolAccess({ allowlist: items })} />
        </div>
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">阻止工具列表</span>
          <ListManager items={rc.toolAccess.blocklist} onChange={(items) => patchToolAccess({ blocklist: items })} />
        </div>
      </Section>

      {/* ---- 上下文 ---- */}
      <Section title="上下文">
        <FieldRow label="压缩阈值 %">
          <Input
            className="w-32 text-right"
            type="number"
            min={50}
            max={95}
            value={rc.contextCompressionThresholdPercent}
            onChange={(e) => patchRc({ contextCompressionThresholdPercent: parseNumInput(e.target.value, rc.contextCompressionThresholdPercent, 50, 95) })}
          />
        </FieldRow>
        <FieldRow label="截断目标 %">
          <Input
            className="w-32 text-right"
            type="number"
            min={40}
            max={90}
            value={rc.contextTruncateTargetPercent}
            onChange={(e) => patchRc({ contextTruncateTargetPercent: parseNumInput(e.target.value, rc.contextTruncateTargetPercent, 40, 90) })}
          />
        </FieldRow>
        <FieldRow label="大窗口压缩起始 %">
          <Input
            className="w-32 text-right"
            type="number"
            min={50}
            max={95}
            value={rc.largeWindowCompressionThresholdPercent}
            onChange={(e) => patchRc({ largeWindowCompressionThresholdPercent: parseNumInput(e.target.value, rc.largeWindowCompressionThresholdPercent, 50, 95) })}
          />
        </FieldRow>
        <FieldRow label="大窗口截断目标 %">
          <Input
            className="w-32 text-right"
            type="number"
            min={40}
            max={90}
            value={rc.largeWindowTruncateTargetPercent}
            onChange={(e) => patchRc({ largeWindowTruncateTargetPercent: parseNumInput(e.target.value, rc.largeWindowTruncateTargetPercent, 40, 90) })}
          />
        </FieldRow>
      </Section>

      {/* ---- 代理 ---- */}
      <Section title="代理">
        <FieldRow label="WebFetch 代理 URL">
          <Input
            aria-label="WebFetch 代理"
            className="w-full"
            value={proxy.webFetch}
            onChange={(e) => patchProxy({ webFetch: e.target.value })}
            placeholder="http://127.0.0.1:7890"
          />
        </FieldRow>
      </Section>

      {/* ---- 恢复 ---- */}
      <Section title="恢复">
        <FieldRow label="最大重试次数">
          <Input
            className="w-32 text-right"
            type="number"
            min={0}
            max={20}
            value={rc.recovery.maxRetryAttempts}
            onChange={(e) => {
              dirty();
              setRc((c) => ({ ...c, recovery: { ...c.recovery, maxRetryAttempts: parseNumInput(e.target.value, c.recovery.maxRetryAttempts, 0, 20) } }));
            }}
          />
        </FieldRow>
        <FieldRow label="退避上限 ms">
          <Input
            className="w-32 text-right"
            type="number"
            min={1000}
            max={120000}
            value={rc.recovery.maxRetryDelayMs}
            onChange={(e) => {
              dirty();
              setRc((c) => ({ ...c, recovery: { ...c.recovery, maxRetryDelayMs: parseNumInput(e.target.value, c.recovery.maxRetryDelayMs, 1000, 120000) } }));
            }}
          />
        </FieldRow>
      </Section>

      {/* ---- 调试 ---- */}
      <Section title="调试">
        <FieldRow label="Dump API 请求"><Switch checked={rc.runtimeDebug.dumpEnabled} onCheckedChange={(v) => patchDebug({ dumpEnabled: v })} /></FieldRow>
      </Section>

      {/* ---- 目录规则 ---- */}
      <Section title="目录规则">
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">全局目录白名单</span>
          <ListManager items={rc.toolAccess.allowlist} onChange={(items) => patchToolAccess({ allowlist: items })} />
        </div>
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">全局目录黑名单</span>
          <ListManager items={rc.toolAccess.blocklist} onChange={(items) => patchToolAccess({ blocklist: items })} />
        </div>
      </Section>

      {/* ---- 底部状态 + 保存 ---- */}
      {(isDirty || saved || error) && (
        <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-background pt-4 pb-2">
          <div className="text-sm">
            {error ? <span className="text-destructive">保存失败：{error}</span> : saved ? <span className="text-emerald-600">✓ 已保存</span> : isDirty ? <span className="text-muted-foreground">有未保存的变更</span> : null}
          </div>
          <Button type="button" onClick={handleSave} disabled={loading || saving || !isDirty}>
            {saving ? "保存中…" : "保存变更"}
          </Button>
        </div>
      )}
    </div>
  );
}
