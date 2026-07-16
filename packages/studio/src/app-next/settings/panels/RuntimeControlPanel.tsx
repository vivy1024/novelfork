import { useEffect, useMemo, useState } from "react";
import { Play, Plus, Trash2, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { createSettingsClient, type RuntimeSettings } from "../../runtime-admin";
import { SettingsGroup, SettingsPage, SettingsSaveBar } from "../components/SettingsPage";
import {
  asRecord,
  buildRuntimeModelOptions,
  type RuntimeReasoningEffort,
} from "../runtime-settings-utils";

const settingsClient = createSettingsClient();

type RuntimeAgentReasoningEffort = Exclude<RuntimeReasoningEffort, "max">;

interface ModelSettingsDraft {
  defaultModel: string;
  summaryModel: string;
  defaultReasoningEffort: RuntimeAgentReasoningEffort | "";
  codexReasoningEffort: RuntimeReasoningEffort | "";
  subagentModels: {
    explore: string;
    plan: string;
    search: string;
  };
  subagentAllowedModels: {
    explore: string[];
    plan: string[];
    general: string[];
    search: string[];
  };
  modelAggregations: Array<{ id: string; name: string; models: string[]; routingMode: "priority" | "balanced" }>;
}

const AGENT_REASONING_OPTIONS = [
  { value: "", label: "使用 Runtime 默认" },
  { value: "none", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
];

const CODEX_REASONING_OPTIONS = [
  { value: "", label: "继承 Agent 默认" },
  { value: "none", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
  { value: "max", label: "最高" },
];

function draftFromSettings(settings: RuntimeSettings): ModelSettingsDraft {
  const agent = asRecord(settings.agent);
  const codex = asRecord(settings.codex);
  const subagentModels = asRecord(agent.subagentModels);
  const allowed = asRecord(agent.subagentAllowedModels);
  return {
    defaultModel: typeof agent.defaultModel === "string" ? agent.defaultModel : "",
    summaryModel: typeof agent.summaryModel === "string" ? agent.summaryModel : "",
    defaultReasoningEffort: (typeof agent.defaultReasoningEffort === "string" ? agent.defaultReasoningEffort : "") as RuntimeAgentReasoningEffort | "",
    codexReasoningEffort: (typeof codex.defaultReasoningEffort === "string" ? codex.defaultReasoningEffort : "") as RuntimeReasoningEffort | "",
    subagentModels: {
      explore: typeof subagentModels.explore === "string" ? subagentModels.explore : "",
      plan: typeof subagentModels.plan === "string" ? subagentModels.plan : "",
      search: typeof subagentModels.search === "string" ? subagentModels.search : "",
    },
    subagentAllowedModels: {
      explore: Array.isArray(allowed.explore) ? allowed.explore.filter((value): value is string => typeof value === "string") : [],
      plan: Array.isArray(allowed.plan) ? allowed.plan.filter((value): value is string => typeof value === "string") : [],
      general: Array.isArray(allowed.general) ? allowed.general.filter((value): value is string => typeof value === "string") : [],
      search: Array.isArray(allowed.search) ? allowed.search.filter((value): value is string => typeof value === "string") : [],
    },
    modelAggregations: Array.isArray(agent.modelAggregations) ? agent.modelAggregations.flatMap((value) => {
      const aggregation = asRecord(value);
      if (typeof aggregation.id !== "string" || typeof aggregation.name !== "string" || !Array.isArray(aggregation.models)) return [];
      return [{ id: aggregation.id, name: aggregation.name, models: aggregation.models.filter((model): model is string => typeof model === "string"), routingMode: aggregation.routingMode === "balanced" ? "balanced" as const : "priority" as const }];
    }) : [],
  };
}

export function RuntimeControlPanel() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [draft, setDraft] = useState<ModelSettingsDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<ModelSettingsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testModel, setTestModel] = useState("");
  const [testPrompt, setTestPrompt] = useState("请用一句话确认 NovelFork 模型连接正常。");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    settingsClient.get()
      .then((data) => {
        if (!active) return;
        const nextDraft = draftFromSettings(data);
        const availableModels = buildRuntimeModelOptions(data);
        const initialTestModel = availableModels.some((model) => model.value === nextDraft.defaultModel)
          ? nextDraft.defaultModel
          : availableModels[0]?.value ?? "";
        setSettings(data);
        setDraft(nextDraft);
        setSavedDraft(nextDraft);
        setTestModel(initialTestModel);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const modelOptions = useMemo(() => settings ? buildRuntimeModelOptions(settings) : [], [settings]);
  const selectOptions = useMemo(() => modelOptions.map((model) => ({
    value: model.value,
    label: `${model.providerLabel} · ${model.label}`,
  })), [modelOptions]);

  function optionsWithCurrent(value: string, inherit = false) {
    const options = inherit ? [{ value: "", label: "继承父叙述者" }, ...selectOptions] : selectOptions;
    if (!value || options.some((option) => option.value === value)) return options;
    return [{ value, label: `${value}（当前配置，未列入标准 API 库）` }, ...options];
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.defaultModel.trim()) {
      setError("默认模型不能为空。请先配置标准 API 供应商并选择一个模型。");
      return;
    }
    const invalidAggregation = draft.modelAggregations.find((aggregation) =>
      !aggregation.id.trim()
      || !aggregation.name.trim()
      || aggregation.models.length === 0
      || aggregation.models.length > 20,
    );
    if (invalidAggregation) {
      setError("每个模型聚合都必须包含名称和 1–20 个标准 API 模型。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsClient.patch({
        agent: {
          defaultModel: draft.defaultModel,
          summaryModel: draft.summaryModel,
          defaultReasoningEffort: draft.defaultReasoningEffort || undefined,
          subagentModels: {
            explore: draft.subagentModels.explore,
            plan: draft.subagentModels.plan,
            search: draft.subagentModels.search,
          },
          subagentAllowedModels: draft.subagentAllowedModels,
          modelAggregations: draft.modelAggregations,
        },
        codex: {
          defaultReasoningEffort: draft.codexReasoningEffort || null,
        },
      });
      const nextDraft = draftFromSettings(updated);
      setSettings(updated);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestModel() {
    if (!testModel || !testPrompt.trim()) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await settingsClient.testModel({ model: testModel, prompt: testPrompt.trim() });
      setTestResult(result.text || "模型已响应，但未返回文本。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取模型配置…</p>;
  if (!draft) return <p className="py-8 text-center text-sm text-destructive">模型配置加载失败。</p>;

  const configuredModelValues = [
    draft.defaultModel,
    draft.summaryModel,
    draft.subagentModels.explore,
    draft.subagentModels.plan,
    draft.subagentModels.search,
    ...Object.values(draft.subagentAllowedModels).flat(),
    ...draft.modelAggregations.flatMap((aggregation) => aggregation.models),
  ];
  const unlistedModelValues = [...new Set(
    configuredModelValues.filter((value) => value && !modelOptions.some((model) => model.value === value)),
  )];
  const dirty = savedDraft !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  return (
    <SettingsPage
      title="模型设置"
      description="新模型选项仅来自用户配置的标准 API；平台账户池不会进入新选择器，已有历史字符串继续保留。"
    >
      {error ? (
        <Alert>
          <AlertTitle>模型设置操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {unlistedModelValues.length > 0 ? (
        <Alert>
          <AlertTitle>检测到未列入标准 API 库的当前模型</AlertTitle>
          <AlertDescription>
            {unlistedModelValues.join("、")} 会继续保留，直到你主动切换为标准 API 模型；它们不会再作为新选项提供。
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsGroup title="模型选择" description="这里只 PATCH Runtime `agent` 中明确支持的通用模型字段。">
        {modelOptions.length === 0 ? (
          <Alert>
            <AlertTitle>没有动态模型库存</AlertTitle>
            <AlertDescription>请先在 AI 供应商中配置标准 API Provider；已有字符串配置仍会保留显示。</AlertDescription>
          </Alert>
        ) : null}
        <ModelSelect label="默认模型" value={draft.defaultModel} options={optionsWithCurrent(draft.defaultModel)} onChange={(value) => setDraft({ ...draft, defaultModel: value })} />
        <ModelSelect label="摘要模型" value={draft.summaryModel} options={optionsWithCurrent(draft.summaryModel)} onChange={(value) => setDraft({ ...draft, summaryModel: value })} />
      </SettingsGroup>

      <SettingsGroup title="子代理模型" description="Runtime 当前支持 explore、plan 和 search 三个默认模型字段。">
        <ModelSelect label="Explore 子代理模型" value={draft.subagentModels.explore} options={optionsWithCurrent(draft.subagentModels.explore, true)} onChange={(value) => setDraft({ ...draft, subagentModels: { ...draft.subagentModels, explore: value } })} />
        <ModelSelect label="Plan 子代理模型" value={draft.subagentModels.plan} options={optionsWithCurrent(draft.subagentModels.plan, true)} onChange={(value) => setDraft({ ...draft, subagentModels: { ...draft.subagentModels, plan: value } })} />
        <ModelSelect label="Search 子代理模型" value={draft.subagentModels.search} options={optionsWithCurrent(draft.subagentModels.search, true)} onChange={(value) => setDraft({ ...draft, subagentModels: { ...draft.subagentModels, search: value } })} />
      </SettingsGroup>

      <SettingsGroup title="子代理允许模型" description="留空表示不额外限制；新增项只能从当前标准 API 模型库存选择。">
        <div className="grid gap-4 lg:grid-cols-2">
          {(["explore", "plan", "general", "search"] as const).map((kind) => (
            <ModelMultiSelect
              key={kind}
              label={`${kind} 允许模型`}
              values={draft.subagentAllowedModels[kind]}
              options={selectOptions}
              onChange={(values) => setDraft({ ...draft, subagentAllowedModels: { ...draft.subagentAllowedModels, [kind]: values } })}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="模型聚合" description="创建 priority 或 balanced 聚合；成员顺序即 priority 路由优先级。">
        <div className="flex flex-col gap-4">
          {draft.modelAggregations.length === 0 ? <p className="text-sm text-muted-foreground">尚未配置模型聚合。</p> : draft.modelAggregations.map((aggregation, index) => (
            <div key={aggregation.id} className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem_auto] lg:items-end">
                <Field>
                  <FieldLabel htmlFor={`aggregation-name-${index}`}>聚合名称</FieldLabel>
                  <Input id={`aggregation-name-${index}`} aria-label={`聚合名称 ${index + 1}`} value={aggregation.name} placeholder="聚合名称" onChange={(event) => setDraft({ ...draft, modelAggregations: draft.modelAggregations.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.currentTarget.value } : item) })} />
                </Field>
                <Field>
                  <FieldLabel>路由方式</FieldLabel>
                  <SimpleSelect aria-label={`聚合路由 ${index + 1}`} value={aggregation.routingMode} onValueChange={(value) => setDraft({ ...draft, modelAggregations: draft.modelAggregations.map((item, itemIndex) => itemIndex === index ? { ...item, routingMode: value === "balanced" ? "balanced" : "priority" } : item) })} options={[{ value: "priority", label: "优先级" }, { value: "balanced", label: "均衡" }]} />
                </Field>
                <Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, modelAggregations: draft.modelAggregations.filter((_, itemIndex) => itemIndex !== index) })}>
                  <Trash2 data-icon="inline-start" />
                  删除
                </Button>
              </div>
              <ModelMultiSelect
                label="聚合成员"
                ariaLabel={`聚合成员 ${index + 1}`}
                values={aggregation.models}
                options={selectOptions}
                maxItems={20}
                onChange={(models) => setDraft({ ...draft, modelAggregations: draft.modelAggregations.map((item, itemIndex) => itemIndex === index ? { ...item, models } : item) })}
              />
            </div>
          ))}
          <Button type="button" variant="outline" disabled={draft.modelAggregations.length >= 50} onClick={() => setDraft({ ...draft, modelAggregations: [...draft.modelAggregations, { id: crypto.randomUUID().replace(/-/g, "").slice(0, 12), name: "", models: [], routingMode: "priority" }] })}>
            <Plus data-icon="inline-start" />
            添加模型聚合
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="推理与思考强度" description="保留 Runtime 的通用推理能力；Anthropic thinking 与 Codex Native 均按各自协议解释。">
        <Field>
          <FieldLabel>Agent 默认推理强度</FieldLabel>
          <SimpleSelect aria-label="Agent 默认推理强度" value={draft.defaultReasoningEffort} onValueChange={(value) => setDraft({ ...draft, defaultReasoningEffort: value as RuntimeAgentReasoningEffort | "" })} options={AGENT_REASONING_OPTIONS} />
          <FieldDescription>作为所有标准 API 的最低优先级默认值。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Codex Native 默认推理强度</FieldLabel>
          <SimpleSelect aria-label="Codex Native 默认推理强度" value={draft.codexReasoningEffort} onValueChange={(value) => setDraft({ ...draft, codexReasoningEffort: value as RuntimeReasoningEffort | "" })} options={CODEX_REASONING_OPTIONS} />
          <FieldDescription>仅配置 Codex Native 协议行为，不展示或启用 Codex 内置账户池。</FieldDescription>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="模型连接测试" description="通过 Runtime `POST /api/settings/test-model` 发起一次真实调用。">
        <ModelSelect label="测试模型" value={testModel} options={optionsWithCurrent(testModel)} onChange={setTestModel} />
        <Field>
          <FieldLabel htmlFor="runtime-test-prompt">测试提示词</FieldLabel>
          <Input id="runtime-test-prompt" aria-label="测试提示词" value={testPrompt} onChange={(event) => setTestPrompt(event.currentTarget.value)} />
        </Field>
        {testResult ? <Alert><AlertTitle>模型响应</AlertTitle><AlertDescription>{testResult}</AlertDescription></Alert> : null}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={handleTestModel} disabled={testing || !testModel || !testPrompt.trim()}>
            <Play data-icon="inline-start" />
            {testing ? "测试中…" : "测试模型"}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="保存模型设置"
        onDiscard={() => {
          if (savedDraft) setDraft(savedDraft);
          setError(null);
        }}
        onSave={() => void handleSave()}
      />
    </SettingsPage>
  );
}

function ModelMultiSelect({
  label,
  ariaLabel = label,
  values,
  options,
  maxItems,
  onChange,
}: {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly values: string[];
  readonly options: Array<{ value: string; label: string }>;
  readonly maxItems?: number;
  readonly onChange: (values: string[]) => void;
}) {
  const labelByValue = new Map(options.map((option) => [option.value, option.label]));
  const availableOptions = options.filter((option) => !values.includes(option.value));
  const atLimit = maxItems !== undefined && values.length >= maxItems;

  return (
    <Field data-settings-slot="model-multi-select">
      <FieldLabel>{label}</FieldLabel>
      <SimpleSelect
        aria-label={ariaLabel}
        value=""
        onValueChange={(value) => {
          if (!value || values.includes(value) || atLimit) return;
          onChange([...values, value]);
        }}
        options={availableOptions}
        placeholder={atLimit ? `最多 ${maxItems} 个模型` : "添加标准 API 模型"}
        disabled={atLimit || availableOptions.length === 0}
      />
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant={labelByValue.has(value) ? "secondary" : "outline"} className="gap-1 pr-1">
              <span>{labelByValue.get(value) ?? `${value}（历史配置）`}</span>
              <button
                type="button"
                aria-label={`移除 ${value}`}
                className="relative inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground after:absolute after:-inset-2.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <FieldDescription>未设置额外限制。</FieldDescription>
      )}
    </Field>
  );
}

function ModelSelect({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: Array<{ value: string; label: string }>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field orientation="responsive">
      <FieldLabel>{label}</FieldLabel>
      <SimpleSelect aria-label={label} value={value} onValueChange={onChange} options={options} placeholder="请选择模型" />
    </Field>
  );
}
