import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Network, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { createDependenciesClient, type DependencyCheckResult } from "../../runtime-admin/dependencies";
import { createSettingsClient, createUserPreferencesClient, type RuntimeSettings } from "../../runtime-admin";
import { buildRuntimeModelOptions } from "../runtime-settings-utils";

const settingsClient = createSettingsClient();
const prefsClient = createUserPreferencesClient();
const depsClient = createDependenciesClient();

const TOTAL_STEPS = 6;

export interface SetupWizardPanelProps {
  readonly onComplete: () => void;
}

/* PLACEHOLDER_REST */

export function SetupWizardPanel({ onComplete }: SetupWizardPanelProps) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [deps, setDeps] = useState<DependencyCheckResult | null>(null);
  const [defaultModel, setDefaultModel] = useState("");
  const [summaryModel, setSummaryModel] = useState("");
  const [networkMode, setNetworkMode] = useState<"local" | "lan" | "open">("local");
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void settingsClient.get().then(setSettings).catch(() => {});
    void depsClient.checkAll().then(setDeps).catch(() => {});
  }, []);

  useEffect(() => {
    if (!settings) return;
    const agent = settings.agent as Record<string, unknown> | undefined;
    if (typeof agent?.defaultModel === "string") setDefaultModel(agent.defaultModel);
    if (typeof agent?.summaryModel === "string") setSummaryModel(agent.summaryModel);
    const host = (settings.server as Record<string, unknown> | undefined)?.host;
    if (host === "0.0.0.0") setNetworkMode("open");
    else if (typeof host === "string" && host !== "localhost" && host !== "127.0.0.1") setNetworkMode("lan");
  }, [settings]);

  const modelOptions = useMemo(() => settings ? buildRuntimeModelOptions(settings) : [], [settings]);
  const selectOptions = useMemo(() => modelOptions.filter((m) => !m.hidden).map((m) => ({ value: m.value, label: m.label || m.value })), [modelOptions]);

  const providerCount = useMemo(() => {
    if (!settings) return 0;
    const custom = Array.isArray(settings.customApiProviders) ? settings.customApiProviders.filter((p: any) => !p.disabled && p.apiKey).length : 0;
    const nug = Array.isArray(settings.nugProviders) ? settings.nugProviders.filter((p: any) => !p.disabled && p.apiKey && p.baseUrl).length : 0;
    return custom + nug;
  }, [settings]);

  const isNextDisabled = step === 2 && providerCount === 0 || step === 3 && (!defaultModel || !summaryModel);

  const finish = useCallback(async () => {
    setFinishing(true);
    setError(null);
    try {
      const hostMap = { local: "localhost", lan: "0.0.0.0", open: "0.0.0.0" } as const;
      await settingsClient.patch({
        agent: { defaultModel, summaryModel },
        server: { host: hostMap[networkMode] },
      });
      await prefsClient.patch({ setupWizardCompleted: true });
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFinishing(false);
    }
  }, [defaultModel, summaryModel, networkMode, onComplete]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h2 className="text-xl font-bold">NovelFork 初始配置</h2>
        <StepIndicator current={step} />
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {step === 0 && <WelcomeStep />}
        {step === 1 && <DepsStep deps={deps} />}
        {step === 2 && <ProviderStep count={providerCount} />}
        {step === 3 && <BasicStep models={selectOptions} defaultModel={defaultModel} summaryModel={summaryModel} onDefaultChange={setDefaultModel} onSummaryChange={setSummaryModel} />}
        {step === 4 && <NetworkStep mode={networkMode} onModeChange={setNetworkMode} />}
        {step === 5 && <CompleteStep />}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex items-center justify-between border-t px-6 py-3">
        <div>{step > 0 && <Button variant="outline" onClick={() => setStep((s) => s - 1)}><ArrowLeft className="mr-1 size-4" />上一步</Button>}</div>
        <div>
          {step < TOTAL_STEPS - 1
            ? <Button onClick={() => setStep((s) => s + 1)} disabled={isNextDisabled}>下一步<ArrowRight className="ml-1 size-4" /></Button>
            : <Button onClick={() => void finish()} disabled={finishing}>{finishing ? "保存中…" : "完成"}<Check className="ml-1 size-4" /></Button>}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div key={i} className={`h-1.5 rounded-full transition-all ${i === current ? "w-6 bg-primary" : i < current ? "w-2 bg-primary/50" : "w-2 bg-muted"}`} />
      ))}
      <span className="ml-2 text-xs text-muted-foreground">步骤 {current + 1}/{TOTAL_STEPS}</span>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <Rocket className="size-12 text-primary" />
      <h3 className="text-lg font-semibold">欢迎使用 NovelFork</h3>
      <p className="max-w-sm text-center text-sm text-muted-foreground">接下来几步帮你检测运行环境、配置 AI 供应商、选择模型和网络模式。</p>
    </div>
  );
}

function DepsStep({ deps }: { deps: DependencyCheckResult | null }) {
  if (!deps) return <p className="text-sm text-muted-foreground">正在检测依赖…</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">以下是运行所需的外部依赖检测结果：</p>
      <div className="flex flex-col gap-2">
        {deps.dependencies.map((dep) => (
          <div key={dep.name} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span className="font-mono text-sm">{dep.name}</span>
            <div className="flex items-center gap-2">
              {dep.version && <span className="text-xs text-muted-foreground">{dep.version}</span>}
              <Badge variant={dep.installed ? "secondary" : dep.required ? "destructive" : "outline"}>{dep.installed ? "已安装" : dep.required ? "缺失" : "可选"}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderStep({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <p className="text-sm text-muted-foreground">至少配置一个 AI 供应商才能使用写作功能。</p>
      <Badge variant={count > 0 ? "secondary" : "destructive"} className="w-fit">{count > 0 ? `已配置 ${count} 个供应商` : "尚未配置供应商"}</Badge>
      {count === 0 && <p className="text-xs text-orange-600">请先前往「设置 → AI 供应商」配置至少一个供应商后回来继续。</p>}
    </div>
  );
}

function BasicStep({ models, defaultModel, summaryModel, onDefaultChange, onSummaryChange }: {
  models: Array<{ value: string; label: string }>;
  defaultModel: string;
  summaryModel: string;
  onDefaultChange: (v: string) => void;
  onSummaryChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <p className="text-sm text-muted-foreground">选择写作和摘要使用的默认模型。两项都选好后才能继续。</p>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">默认模型</label>
        <SimpleSelect aria-label="默认模型" value={defaultModel} onValueChange={onDefaultChange} options={models} />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">摘要模型</label>
        <SimpleSelect aria-label="摘要模型" value={summaryModel} onValueChange={onSummaryChange} options={models} />
      </div>
      {(!defaultModel || !summaryModel) && <p className="text-xs text-orange-600">请选择两个模型后继续。</p>}
    </div>
  );
}

function NetworkStep({ mode, onModeChange }: { mode: "local" | "lan" | "open"; onModeChange: (m: "local" | "lan" | "open") => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <Network className="size-10 text-primary" />
      <p className="text-center text-sm text-muted-foreground">选择 Runtime 监听方式。完成后会保存并可能需要重启。</p>
      <div className="flex gap-2">
        {(["local", "lan", "open"] as const).map((m) => (
          <Button key={m} variant={mode === m ? "default" : "outline"} size="sm" onClick={() => onModeChange(m)}>
            {m === "local" ? "仅本机" : m === "lan" ? "局域网" : "开放访问"}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{mode === "local" ? "只能从本机访问 (localhost)。" : mode === "lan" ? "同局域网设备可访问。" : "所有网络可访问（0.0.0.0），请确保防火墙安全。"}</p>
    </div>
  );
}

function CompleteStep() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <Check className="size-12 text-green-500" />
      <h3 className="text-lg font-semibold">配置完成！</h3>
      <p className="max-w-sm text-center text-sm text-muted-foreground">你随时可以在设置中修改这些选项。点击下方完成按钮开始使用。</p>
    </div>
  );
}
