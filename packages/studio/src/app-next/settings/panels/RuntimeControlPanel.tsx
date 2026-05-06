import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchJson, putApi } from "@/hooks/use-api";
import { createLenientFetchJsonContractClient, createProviderClient } from "@/app-next/backend-contract";
import { runtimeModelLabel, usableRuntimeModels, type RuntimeModelOption } from "@/lib/runtime-model-options";
import { SESSION_PERMISSION_MODE_OPTIONS } from "@/shared/session-types";
import type { ModelDefaultSettings, RuntimeControlSettings, UserConfig } from "@/types/settings";
import { DEFAULT_USER_CONFIG } from "@/types/settings";

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

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

const selectCls = "rounded-md border border-border bg-background px-2 py-1 text-sm";
const inputCls = "w-32 rounded-md border border-border bg-background px-2 py-1 text-sm text-right";
const wideInputCls = "w-56 rounded-md border border-border bg-background px-2 py-1 text-sm";

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
        <input
          className={`${wideInputCls} flex-1`}
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
              <button
                className="text-xs text-destructive hover:underline"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                type="button"
              >
                删除
              </button>
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
  const [modelOptions, setModelOptions] = useState<RuntimeModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function applyUserConfig(data: Pick<UserConfig, "runtimeControls" | "modelDefaults">) {
    setRc({ ...DEFAULT_RUNTIME_CONTROLS, ...(data.runtimeControls ?? {}) });
    setMd({
      ...DEFAULT_MODEL_DEFAULTS,
      ...(data.modelDefaults ?? {}),
      subagentModelPool: data.modelDefaults?.subagentModelPool ?? DEFAULT_MODEL_DEFAULTS.subagentModelPool,
    });
  }

  async function refetchUserConfig() {
    const data = await fetchJson<Pick<UserConfig, "runtimeControls" | "modelDefaults">>("/settings/user");
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
      await putApi<UserConfig>("/settings/user", { runtimeControls: rc, modelDefaults: md });
      await refetchUserConfig();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // --- shorthand updaters ---
  const dirty = () => setSaved(false);
  const patchRc = (patch: Partial<ExtendedRuntimeControls>) => { dirty(); setRc((c) => ({ ...c, ...patch })); };
  const patchMd = (patch: Partial<ModelDefaultSettings>) => { dirty(); setMd((c) => ({ ...c, ...patch })); };
  const patchToolAccess = (patch: Partial<RuntimeControlSettings["toolAccess"]>) => {
    dirty();
    setRc((c) => ({ ...c, toolAccess: { ...c.toolAccess, ...patch } }));
  };
  const patchDebug = (patch: Partial<RuntimeControlSettings["runtimeDebug"]>) => {
    dirty();
    setRc((c) => ({ ...c, runtimeDebug: { ...c.runtimeDebug, ...patch } }));
  };
  const hasModelOptions = modelOptions.length > 0;

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">正在读取运行控制配置…</p>;
  }

  return (
    <div className="space-y-6">
      {/* ---- 权限与推理 ---- */}
      <Section title="权限与推理">
        <FieldRow label="默认权限模式">
          <select className={selectCls} value={rc.defaultPermissionMode} onChange={(e) => patchRc({ defaultPermissionMode: e.target.value as RuntimeControlSettings["defaultPermissionMode"] })}>
            {PERMISSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="默认推理强度">
          <select className={selectCls} value={rc.defaultReasoningEffort} onChange={(e) => patchRc({ defaultReasoningEffort: e.target.value as RuntimeControlSettings["defaultReasoningEffort"] })}>
            {REASONING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
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
          <select
            aria-label="默认会话模型"
            className={wideInputCls}
            value={md.defaultSessionModel}
            disabled={!hasModelOptions}
            onChange={(e) => patchMd({ defaultSessionModel: e.target.value })}
          >
            <option value="" disabled>请选择模型</option>
            {modelOptions.map((model) => (
              <option key={model.modelId} value={model.modelId}>{runtimeModelLabel(model)}（会话）</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="摘要模型">
          <select
            aria-label="摘要模型"
            className={wideInputCls}
            value={md.summaryModel}
            disabled={!hasModelOptions}
            onChange={(e) => patchMd({ summaryModel: e.target.value })}
          >
            <option value="" disabled>请选择模型</option>
            {modelOptions.map((model) => (
              <option key={model.modelId} value={model.modelId}>{runtimeModelLabel(model)}（摘要）</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="子代理模型池">
          <select
            aria-label="子代理模型池"
            className={`${wideInputCls} min-h-20`}
            multiple
            value={md.subagentModelPool}
            disabled={!hasModelOptions}
            onChange={(e) =>
              patchMd({
                subagentModelPool: Array.from(e.currentTarget.selectedOptions, (option) => option.value),
              })
            }
          >
            {modelOptions.map((model) => (
              <option key={model.modelId} value={model.modelId}>{runtimeModelLabel(model)}（子代理）</option>
            ))}
          </select>
        </FieldRow>
      </Section>

      {/* ---- 行为 ---- */}
      <Section title="行为">
        <FieldRow label="翻译思考内容"><Switch checked={rc.translateThinking ?? false} onChange={(v) => patchRc({ translateThinking: v })} /></FieldRow>
        <FieldRow label="默认展开推理内容"><Switch checked={rc.expandReasoning ?? false} onChange={(v) => patchRc({ expandReasoning: v })} /></FieldRow>
        <FieldRow label="默认宽松规划"><Switch checked={rc.relaxedPlanning ?? true} onChange={(v) => patchRc({ relaxedPlanning: v })} /></FieldRow>
        <FieldRow label="智能检查输出中断"><Switch checked={rc.smartOutputCheck ?? true} onChange={(v) => patchRc({ smartOutputCheck: v })} /></FieldRow>
        <FieldRow label="要求使用您的语言回复"><Switch checked={rc.forceUserLanguage ?? false} onChange={(v) => patchRc({ forceUserLanguage: v })} /></FieldRow>
      </Section>

      {/* ---- MCP 策略 ---- */}
      <Section title="MCP 策略">
        <FieldRow label="MCP 工具策略">
          <select className={selectCls} value={rc.toolAccess.mcpStrategy} onChange={(e) => patchToolAccess({ mcpStrategy: e.target.value as RuntimeControlSettings["toolAccess"]["mcpStrategy"] })}>
            {MCP_POLICY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
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
          <input
            className={inputCls}
            type="number"
            min={50}
            max={95}
            value={rc.contextCompressionThresholdPercent}
            onChange={(e) => patchRc({ contextCompressionThresholdPercent: parseNumInput(e.target.value, rc.contextCompressionThresholdPercent, 50, 95) })}
          />
        </FieldRow>
        <FieldRow label="截断目标 %">
          <input
            className={inputCls}
            type="number"
            min={40}
            max={90}
            value={rc.contextTruncateTargetPercent}
            onChange={(e) => patchRc({ contextTruncateTargetPercent: parseNumInput(e.target.value, rc.contextTruncateTargetPercent, 40, 90) })}
          />
        </FieldRow>
      </Section>

      {/* ---- 恢复 ---- */}
      <Section title="恢复">
        <FieldRow label="最大重试次数">
          <input
            className={inputCls}
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
          <input
            className={inputCls}
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
        <FieldRow label="显示 Token 用量"><Switch checked={rc.runtimeDebug.tokenDebugEnabled} onChange={(v) => patchDebug({ tokenDebugEnabled: v })} /></FieldRow>
        <FieldRow label="显示实时输出速率"><Switch checked={rc.runtimeDebug.rateDebugEnabled} onChange={(v) => patchDebug({ rateDebugEnabled: v })} /></FieldRow>
        <FieldRow label="Dump API 请求"><Switch checked={rc.runtimeDebug.dumpEnabled} onChange={(v) => patchDebug({ dumpEnabled: v })} /></FieldRow>
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
      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="text-sm">
          {error ? <span className="text-destructive">保存失败：{error}</span> : saved ? <span className="text-primary">已保存</span> : null}
        </div>
        <Button type="button" onClick={handleSave} disabled={loading || saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
