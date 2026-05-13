import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { fetchJson, putApi } from "@/hooks/use-api";
import { USER_SETTINGS_API_PATH, createLenientFetchJsonContractClient, createProviderClient } from "@/app-next/backend-contract";
import { runtimeModelLabel, usableRuntimeModels, type RuntimeModelOption } from "@/lib/runtime-model-options";
import { notify } from "@/lib/notify";
import type { ModelDefaultSettings, RuntimeControlSettings, UserConfig } from "@/types/settings";
import { DEFAULT_USER_CONFIG } from "@/types/settings";

// ---------------------------------------------------------------------------
// Option definitions
// ---------------------------------------------------------------------------

const REASONING_OPTIONS: Array<{
  value: ModelDefaultSettings["codexReasoningEffort"];
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

const DEFAULT_RUNTIME_CONTROLS = DEFAULT_USER_CONFIG.runtimeControls;
const DEFAULT_MODEL_DEFAULTS = DEFAULT_USER_CONFIG.modelDefaults;

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

// ---------------------------------------------------------------------------
// Main panel — Model Settings only
// ---------------------------------------------------------------------------

export function RuntimeControlPanel() {
  const [rc, setRc] = useState(DEFAULT_RUNTIME_CONTROLS);
  const [md, setMd] = useState<ModelDefaultSettings>(DEFAULT_MODEL_DEFAULTS);
  const [modelOptions, setModelOptions] = useState<RuntimeModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  function applyUserConfig(data: Pick<UserConfig, "runtimeControls" | "modelDefaults">) {
    setRc({ ...DEFAULT_RUNTIME_CONTROLS, ...(data.runtimeControls ?? {}) });
    setMd({
      ...DEFAULT_MODEL_DEFAULTS,
      ...(data.modelDefaults ?? {}),
      subagentModelPool: data.modelDefaults?.subagentModelPool ?? DEFAULT_MODEL_DEFAULTS.subagentModelPool,
    });
    setIsDirty(false);
  }

  async function refetchUserConfig() {
    const data = await fetchJson<Pick<UserConfig, "runtimeControls" | "modelDefaults">>(USER_SETTINGS_API_PATH);
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
      await refetchUserConfig();
      setSaved(true);
      setIsDirty(false);
      notify.success("运行时设置已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // --- shorthand updaters ---
  const dirty = () => { setSaved(false); setIsDirty(true); };
  const patchRc = (patch: Partial<RuntimeControlSettings>) => { dirty(); setRc((c) => ({ ...c, ...patch })); };
  const patchMd = (patch: Partial<ModelDefaultSettings>) => { dirty(); setMd((c) => ({ ...c, ...patch })); };
  const hasModelOptions = modelOptions.length > 0;

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">正在读取模型配置…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-foreground">模型设置</h2>
        <p className="text-sm text-muted-foreground">配置默认模型、子代理模型和推理强度。</p>
      </div>

      {/* ---- 模型选择 ---- */}
      <Section title="默认模型">
        {hasModelOptions ? (
          <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            默认会话模型{md.defaultSessionModel ? "已从用户设置读取" : "未配置，请选择模型池中的可用模型"}
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            尚未配置可用模型，请先在供应商页面添加。
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
      </Section>

      {/* ---- 子代理模型 ---- */}
      <Section title="子代理模型">
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

      {/* ---- 推理强度 ---- */}
      <Section title="推理强度">
        <FieldRow label="全局默认推理强度">
          <SimpleSelect
            value={rc.defaultReasoningEffort}
            onValueChange={(val) => patchRc({ defaultReasoningEffort: val as RuntimeControlSettings["defaultReasoningEffort"] })}
            options={REASONING_OPTIONS}
            aria-label="全局默认推理强度"
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
      </Section>

      {/* ---- 小说特有 ---- */}
      <Section title="小说写作">
        <FieldRow label="角色弧线追踪模式">
          <SimpleSelect
            value={rc.arcTrackingMode ?? "rule"}
            onValueChange={(val) => patchRc({ arcTrackingMode: val as NonNullable<RuntimeControlSettings["arcTrackingMode"]> })}
            options={ARC_TRACKING_OPTIONS}
            aria-label="角色弧线追踪模式"
          />
        </FieldRow>
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
