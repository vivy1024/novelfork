/**
 * P1-5: Agent 管理面板
 * 展示 16 个 agent 的状态、配置、模型路由信息
 */
import { useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronRight, RefreshCw, RotateCcw, Zap } from "lucide-react";

import { useApi, fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Nav {
  toWorkflow?: () => void;
}

// 16 个 agent 的静态元数据
const AGENTS = [
  { id: "writer", name: "Writer", desc: "章节正文写作", category: "core" },
  { id: "planner", name: "Planner", desc: "章节规划与 intent 生成", category: "core" },
  { id: "composer", name: "Composer", desc: "上下文包组装", category: "core" },
  { id: "auditor", name: "Continuity Auditor", desc: "连续性审计（32维度）", category: "quality" },
  { id: "reviser", name: "Reviser", desc: "章节修订（5种模式）", category: "quality" },
  { id: "state-validator", name: "State Validator", desc: "状态校验", category: "quality" },
  { id: "foundation-reviewer", name: "Foundation Reviewer", desc: "基础设定审查", category: "quality" },
  { id: "post-write-validator", name: "Post-Write Validator", desc: "写后校验", category: "quality" },
  { id: "length-normalizer", name: "Length Normalizer", desc: "字数归一化", category: "quality" },
  { id: "chapter-analyzer", name: "Chapter Analyzer", desc: "章节深度分析", category: "analysis" },
  { id: "consolidator", name: "Consolidator", desc: "状态整合", category: "analysis" },
  { id: "style-analyzer", name: "Style Analyzer", desc: "文风分析与生成", category: "analysis" },
  { id: "radar", name: "Radar", desc: "市场趋势扫描", category: "analysis" },
  { id: "architect", name: "Architect", desc: "世界观与卷纲设计", category: "creation" },
  { id: "detector", name: "AI Tells Detector", desc: "AI 痕迹检测", category: "detection" },
  { id: "sensitive-words", name: "Sensitive Words", desc: "敏感词检测", category: "detection" },
] as const;

const CATEGORIES: Record<string, string> = {
  core: "核心写作",
  quality: "质量保障",
  analysis: "分析洞察",
  creation: "创作辅助",
  detection: "检测防护",
};

interface OverridesData {
  readonly overrides: Record<string, { model?: string; provider?: string; baseUrl?: string }>;
}

export function AgentPanel({ nav, theme }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: overridesData, refetch } = useApi<OverridesData>("/project/model-overrides");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const overrides = overridesData?.overrides ?? {};

  const toggle = (id: string) => setExpanded(expanded === id ? null : id);

  const handleTest = async (agentId: string) => {
    setTesting(agentId);
    try {
      const res = await fetchJson<{ ok: boolean; reply?: string; error?: string }>("/llm/test", { method: "POST" });
      setTestResults({
        ...testResults,
        [agentId]: res.ok ? { ok: true, msg: res.reply ?? "OK" } : { ok: false, msg: res.error ?? "失败" },
      });
    } catch (e) {
      setTestResults({
        ...testResults,
        [agentId]: { ok: false, msg: e instanceof Error ? e.message : "测试失败" },
      });
    } finally {
      setTesting(null);
    }
  };

  const grouped = Object.entries(CATEGORIES).map(([catId, catName]) => ({
    id: catId,
    name: catName,
    agents: AGENTS.filter((a) => a.category === catId),
  }));

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Agent 管理面板"
        description="把写作 routines 的路由、默认模型覆盖和测试入口收口到一个工作流工位。"
        actions={
          <>
            {nav.toWorkflow && (
              <button onClick={() => nav.toWorkflow?.()} className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70">
                工作流总览
              </button>
            )}
            <button onClick={() => void refetch()} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RefreshCw size={12} />刷新
            </button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard c={c} label="Agent 总数" value={String(AGENTS.length)} />
        <StatCard c={c} label="已配置路由" value={String(Object.keys(overrides).filter((k) => overrides[k]?.model).length)} />
        <StatCard c={c} label="分类" value={String(Object.keys(CATEGORIES).length)} />
        <StatCard c={c} label="覆盖率" value={`${Math.round((Object.keys(overrides).filter((k) => overrides[k]?.model).length / AGENTS.length) * 100)}%`} />
      </div>

      {grouped.map((group) => (
        <section key={group.id} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{group.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{group.agents.length} 个 Agent</p>
            </div>
          </div>
          <div className="space-y-2">
            {group.agents.map((agent) => {
              const isExpanded = expanded === agent.id;
              const override = overrides[agent.id];
              const hasOverride = !!override?.model;
              const result = testResults[agent.id];
              return (
                <div key={agent.id} className={`rounded-lg border ${c.cardStatic}`}>
                  <button onClick={() => toggle(agent.id)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Bot size={16} className={hasOverride ? "text-primary" : "text-muted-foreground"} />
                      <div>
                        <span className="text-sm font-medium">{agent.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{agent.desc}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasOverride ? (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">{override!.model}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">默认模型</span>
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/40 px-4 py-3 space-y-3">
                      <div className="grid gap-4 text-sm md:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">模型: </span>
                          <span className="font-mono">{override?.model || "(项目默认)"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">协议: </span>
                          <span className="font-mono">{override?.provider || "(项目默认)"}</span>
                        </div>
                        <div className="md:col-span-2">
                          <span className="text-muted-foreground">Base URL: </span>
                          <span className="font-mono">{override?.baseUrl || "(项目默认)"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTest(agent.id)}
                          disabled={testing === agent.id}
                          className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${c.btnSecondary} disabled:opacity-50`}
                        >
                          {testing === agent.id ? <RotateCcw size={12} className="animate-spin" /> : <Zap size={12} />}
                          {testing === agent.id ? "测试中..." : "测试连接"}
                        </button>
                        {result && (
                          <span className={`text-xs ${result.ok ? "text-emerald-500" : "text-red-500"}`}>
                            {result.ok ? "连接成功" : `失败: ${result.msg}`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
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

function StatCard({ c, label, value }: { c: ReturnType<typeof useColors>; label: string; value: string }) {
  return (
    <div className={`rounded-2xl border ${c.cardStatic} px-4 py-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
