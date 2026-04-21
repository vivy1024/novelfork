/**
 * P1-5: Agent 管理面板
 * 展示 16 个 agent 的状态、配置、模型路由信息
 */
import { useState } from "react";
import { useApi, fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Bot, ChevronDown, ChevronRight, Zap, Settings2, RotateCcw } from "lucide-react";

interface Nav {
  toDashboard: () => void;
  toWorkflow: () => void;
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

export function AgentPanel({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: overridesData } = useApi<OverridesData>("/project/model-overrides");
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
    <div className="space-y-8">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <span className="text-foreground">Agent 管理</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">Agent 管理</h1>
        <button onClick={nav.toWorkflow} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary} flex items-center gap-1`}>
          <Settings2 size={12} />返回工作流台
        </button>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard c={c} label="Agent 总数" value={String(AGENTS.length)} />
        <StatCard c={c} label="已配置路由" value={String(Object.keys(overrides).filter((k) => overrides[k]?.model).length)} />
        <StatCard c={c} label="分类" value={String(Object.keys(CATEGORIES).length)} />
      </div>

      {/* 按分类展示 */}
      {grouped.map((group) => (
        <div key={group.id} className="space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-muted-foreground font-medium">{group.name}</h2>
          <div className="space-y-2">
            {group.agents.map((agent) => {
              const isExpanded = expanded === agent.id;
              const override = overrides[agent.id];
              const hasOverride = !!(override?.model);
              const result = testResults[agent.id];
              return (
                <div key={agent.id} className={`border ${c.cardStatic} rounded-lg`}>
                  <button
                    onClick={() => toggle(agent.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Bot size={16} className={hasOverride ? "text-primary" : "text-muted-foreground"} />
                      <div>
                        <span className="text-sm font-medium">{agent.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{agent.desc}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasOverride && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                          {override!.model}
                        </span>
                      )}
                      {!hasOverride && (
                        <span className="text-xs text-muted-foreground">默认模型</span>
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/40 px-4 py-3 space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">模型: </span>
                          <span className="font-mono">{override?.model || "(项目默认)"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">协议: </span>
                          <span className="font-mono">{override?.provider || "(项目默认)"}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Base URL: </span>
                          <span className="font-mono">{override?.baseUrl || "(项目默认)"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTest(agent.id)}
                          disabled={testing === agent.id}
                          className={`px-3 py-1.5 text-xs rounded-md ${c.btnSecondary} disabled:opacity-50 flex items-center gap-1`}
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
        </div>
      ))}
    </div>
  );
}

function StatCard({ c, label, value }: { c: ReturnType<typeof useColors>; label: string; value: string }) {
  return (
    <div className={`border ${c.cardStatic} rounded-lg px-4 py-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-serif mt-1">{value}</div>
    </div>
  );
}
