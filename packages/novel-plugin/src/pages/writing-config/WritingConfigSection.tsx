import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, BrainCircuit, Loader2, Sparkles, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { WritingSkillsPanel } from "../writing-workbench/WritingSkillsPanel";

type ConfigTab = "skills" | "memory" | "tools";

interface ToolItem {
  readonly id: string;
  readonly label: string;
}

const OPTIONAL_TOOLS: readonly ToolItem[] = [
  { id: "lore.read", label: "静态设定" },
  { id: "memory.read", label: "叙事记忆" },
  { id: "memory.graph", label: "记忆图谱" },
  { id: "memory.events", label: "待确认事件" },
  { id: "chapter.read", label: "章节" },
  { id: "cockpit.snapshot", label: "快照" },
  { id: "hooks.manage", label: "伏笔" },
  { id: "character.check_consistency", label: "角色一致性" },
  { id: "writing-skills.check_compliance", label: "合规检查" },
  { id: "narrative.read_line", label: "叙事线" },
];

const ROLE_DEFAULTS: readonly string[] = [
  "lore.read",
  "memory.read",
  "chapter.read",
  "cockpit.snapshot",
  "hooks.manage",
  "writing-skills.check_compliance",
];

function toolStorageKey(sessionId: string): string {
  return `novelfork-tool-config-${sessionId}`;
}

function loadToolConfig(sessionId: string | undefined): Set<string> | null {
  if (!sessionId) return null;
  try {
    const raw = localStorage.getItem(toolStorageKey(sessionId));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function saveToolConfig(sessionId: string | undefined, enabled: Set<string>): void {
  if (!sessionId) return;
  try {
    localStorage.setItem(toolStorageKey(sessionId), JSON.stringify([...enabled]));
  } catch {
    // Best effort only: the session policy remains the server-side authority.
  }
}

type NarrativeMemorySettings = {
  version: 1;
  settlement: {
    enabled: boolean;
    autoApplyLowRisk: boolean;
    autoApplyMediumRisk: boolean;
    highRiskAlwaysPending: boolean;
    minConfidence: number;
    blockWriteOnHighRiskPending: boolean;
    useLlmExtraction: boolean;
  };
  ledger: { closeSupersededFacts: boolean; currentViewLimit: number };
  retrieval: {
    maxTokens: number;
    channels: { state: boolean; timeline: boolean; hooks: boolean; facts: boolean; style: boolean; semantic: boolean };
    waveEnabled: boolean;
    semanticEnabled: boolean;
  };
};

function NarrativeMemoryToggle({ label, description, checked, onCheckedChange, disabled }: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div data-slot="narrative-memory-toggle" className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} className="shrink-0" />
    </div>
  );
}

/** Book-scoped narrative memory settings, reusable from both configuration surfaces. */
export function NarrativeMemorySettingsSection({ bookId }: { bookId: string }) {
  const [config, setConfig] = useState<NarrativeMemorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/config`);
      const payload = await response.json().catch(() => null) as { config?: NarrativeMemorySettings; error?: string } | null;
      if (!response.ok || !payload?.config) throw new Error(payload?.error ?? "无法加载叙事记忆配置");
      setConfig(payload.config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载叙事记忆配置");
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback((patch: (current: NarrativeMemorySettings) => NarrativeMemorySettings) => {
    setConfig((current) => current ? patch(current) : current);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const payload = await response.json().catch(() => null) as { config?: NarrativeMemorySettings; error?: string } | null;
      if (!response.ok || !payload?.config) throw new Error(payload?.error ?? "无法保存叙事记忆配置");
      setConfig(payload.config);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存叙事记忆配置");
    } finally {
      setSaving(false);
    }
  }, [bookId, config]);

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8">
        <AlertCircle className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error ?? "无法加载叙事记忆配置"}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
      </div>
    );
  }

  const updateSettlement = (patch: Partial<NarrativeMemorySettings["settlement"]>) => update((current) => ({ ...current, settlement: { ...current.settlement, ...patch } }));
  const updateLedger = (patch: Partial<NarrativeMemorySettings["ledger"]>) => update((current) => ({ ...current, ledger: { ...current.ledger, ...patch } }));
  const updateRetrieval = (patch: Partial<NarrativeMemorySettings["retrieval"]>) => update((current) => ({ ...current, retrieval: { ...current.retrieval, ...patch } }));
  const updateChannel = (channel: keyof NarrativeMemorySettings["retrieval"]["channels"], checked: boolean) => update((current) => ({
    ...current,
    retrieval: { ...current.retrieval, channels: { ...current.retrieval.channels, [channel]: checked } },
  }));

  return (
    <div data-slot="narrative-memory-settings" className="flex flex-col gap-4">
      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="size-4 text-primary" />动态事实与当前账本</div>
        <p className="mt-1 text-[11px] text-muted-foreground">经纬负责静态设定；这里控制章节结算、旧事实失效和写作前动态召回。</p>
      </div>
      {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">章节结算</p>
        <NarrativeMemoryToggle label="自动结算确认章节" description="章节正式确认后提取动态事件；关闭后不写入新的叙事事实。" checked={config.settlement.enabled} onCheckedChange={(checked) => updateSettlement({ enabled: checked })} />
        <NarrativeMemoryToggle label="自动应用低风险事件" description="高置信、低风险的角色状态和情节变化直接进入账本。" checked={config.settlement.autoApplyLowRisk} onCheckedChange={(checked) => updateSettlement({ autoApplyLowRisk: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="自动应用中风险事件" description="中风险事件无需作者审批即可结算；高风险事件仍保留人工确认。" checked={config.settlement.autoApplyMediumRisk} onCheckedChange={(checked) => updateSettlement({ autoApplyMediumRisk: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="高风险事件始终待审" description="涉及世界规则、核心伏笔或不可逆变化时，始终进入作者确认队列。" checked={config.settlement.highRiskAlwaysPending} onCheckedChange={(checked) => updateSettlement({ highRiskAlwaysPending: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="使用 LLM 提取事件" description="关闭后仅使用规则与已有运行时状态提取章后事件。" checked={config.settlement.useLlmExtraction} onCheckedChange={(checked) => updateSettlement({ useLlmExtraction: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="高风险待审时阻断写作" description="默认只提醒，不阻断；开启后需先处理高风险待审事件。" checked={config.settlement.blockWriteOnHighRiskPending} onCheckedChange={(checked) => updateSettlement({ blockWriteOnHighRiskPending: checked })} />
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <span className="min-w-0 text-sm font-medium">自动结算最低置信度</span>
          <Input aria-label="自动结算最低置信度" type="number" min={0} max={1} step={0.05} value={config.settlement.minConfidence} onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 0 && value <= 1) updateSettlement({ minConfidence: value });
          }} className="h-8 w-24 text-right" />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">当前故事状态</p>
        <NarrativeMemoryToggle label="关闭被新事实取代的旧记录" description="同一实体、主题的新状态落库时，将旧事实标记为在当前章失效，保证账本收敛。" checked={config.ledger.closeSupersededFacts} onCheckedChange={(checked) => updateLedger({ closeSupersededFacts: checked })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">写前召回</p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Token 预算
            <Input aria-label="叙事记忆 token 预算" type="number" min={500} max={100000} step={500} value={config.retrieval.maxTokens} onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 500 && value <= 100000) updateRetrieval({ maxTokens: value });
            }} className="h-8 w-24 text-right" />
          </label>
        </div>
        <NarrativeMemoryToggle label="状态通道" description="召回当前角色、地点、运行态和实体相关的账本事实。" checked={config.retrieval.channels.state} onCheckedChange={(checked) => updateChannel("state", checked)} />
        <NarrativeMemoryToggle label="时间线通道" description="召回近期章节和前章衔接信息。" checked={config.retrieval.channels.timeline} onCheckedChange={(checked) => updateChannel("timeline", checked)} />
        <NarrativeMemoryToggle label="伏笔通道" description="召回已埋设、待推进的伏笔和对应提醒。" checked={config.retrieval.channels.hooks} onCheckedChange={(checked) => updateChannel("hooks", checked)} />
        <NarrativeMemoryToggle label="结构化事实通道" description="按场景实体召回当前账本事实及一跳关联。" checked={config.retrieval.channels.facts} onCheckedChange={(checked) => updateChannel("facts", checked)} />
        <NarrativeMemoryToggle label="风格通道" description="召回文风和已启用 Writing Skills 的提示。" checked={config.retrieval.channels.style} onCheckedChange={(checked) => updateChannel("style", checked)} />
        <NarrativeMemoryToggle label="语义召回" description="使用向量/语义候选；需要书籍可用的语义索引或提供方。" checked={config.retrieval.semanticEnabled && config.retrieval.channels.semantic} onCheckedChange={(checked) => updateRetrieval({ semanticEnabled: checked, channels: { ...config.retrieval.channels, semantic: checked } })} />
        <NarrativeMemoryToggle label="Wave 重排" description="对已召回上下文进行关联扩展和能量重排，默认关闭以保证稳定预算。" checked={config.retrieval.waveEnabled} onCheckedChange={(checked) => updateRetrieval({ waveEnabled: checked })} />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        {saved && <span className="text-xs text-primary">已保存</span>}
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="mr-1 size-3.5 animate-spin" />}
          保存叙事记忆设置
        </Button>
      </div>
    </div>
  );
}

function ToolsTab({ sessionId }: { sessionId?: string }) {
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => loadToolConfig(sessionId) ?? new Set(ROLE_DEFAULTS));

  useEffect(() => { setEnabledTools(loadToolConfig(sessionId) ?? new Set(ROLE_DEFAULTS)); }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    saveToolConfig(sessionId, enabledTools);
    const deny = OPTIONAL_TOOLS.map((tool) => tool.id).filter((id) => !enabledTools.has(id));
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionConfig: { toolPolicy: { deny } } }),
    }).catch(() => undefined);
  }, [sessionId, enabledTools]);

  if (!sessionId) {
    return <div className="flex flex-col items-center justify-center gap-2 py-8"><Wrench className="size-6 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">请在写作会话中配置工具开关</p></div>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">勾选 Agent 写作时可主动调用的辅助工具。未勾选的工具将被禁用。</p>
      <div className="space-y-1.5">
        {OPTIONAL_TOOLS.map((tool) => {
          const checked = enabledTools.has(tool.id);
          return <label key={tool.id} className="flex cursor-pointer items-center gap-2 select-none rounded-md border border-border p-2 hover:bg-muted/50" title={tool.id}>
            <input type="checkbox" checked={checked} onChange={() => setEnabledTools((previous) => {
              const next = new Set(previous);
              if (next.has(tool.id)) next.delete(tool.id); else next.add(tool.id);
              return next;
            })} className="size-4 accent-primary shrink-0" />
            <span className={cn("text-sm font-medium", checked ? "text-foreground" : "text-muted-foreground")}>{tool.label}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/70 font-mono">{tool.id}</span>
          </label>;
        })}
      </div>
    </div>
  );
}

const TABS: ReadonlyArray<{ id: ConfigTab; label: string; icon: typeof Sparkles }> = [
  { id: "skills", label: "Writing Skills", icon: Sparkles },
  { id: "memory", label: "叙事记忆", icon: BrainCircuit },
  { id: "tools", label: "辅助工具", icon: Wrench },
];

export function WritingConfigSection({ bookId, sessionId }: { bookId?: string; sessionId?: string }) {
  const [activeTab, setActiveTab] = useState<ConfigTab>("skills");
  const needsBook = activeTab === "skills" || activeTab === "memory";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn(
            "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}><Icon className="size-3.5" />{tab.label}</button>;
        })}
      </div>
      <div>
        {needsBook && !bookId ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2"><AlertCircle className="size-6 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">请先选择书籍</p></div>
        ) : (
          <>
            {activeTab === "skills" && bookId && <WritingSkillsPanel bookId={bookId} />}
            {activeTab === "memory" && bookId && <NarrativeMemorySettingsSection bookId={bookId} />}
            {activeTab === "tools" && <ToolsTab sessionId={sessionId} />}
          </>
        )}
      </div>
    </div>
  );
}
