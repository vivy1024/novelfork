/**
 * 本章 AI 注入透视卡片（PrepInjectionPreviewCard）
 *
 * 在作者点击「交叙述者起草本章」之前，将 `write.preflight` 返回的 `recallSummary`、
 * `openHooksForChapter`、`dueForeshadows`、`requiredSkillAcknowledgements` 可视化展开：
 * - 总估计 Token / 预算上限与进度条
 * - 各通道卡片数与 Token 占比
 * - 本章注入的伏笔、角色声线、文风范文（含点选置顶标记）、生效中的 Writing Skills
 * - 超预算被裁剪/降档的卡片警告
 */

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  Mic,
  Sparkles,
  Tag,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WritePreflightRecallSummary } from "../../handlers/write-preflight";

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  "scene-spec": "章节蓝图",
  hard: "硬性设定规则",
  state: "角色与世界状态",
  hooks: "活跃伏笔",
  timeline: "时间线动态",
  facts: "叙事事实",
  style: "文风与声线",
  semantic: "语义联想",
  "character-kernel": "角色内核",
  "story-arc": "层级卷梗概",
  "recent-summary": "近章摘要",
  knowledge: "角色知情边界",
  "prose-evidence": "前文原文证据",
};

const SCENE_TYPE_LABELS: Readonly<Record<string, string>> = {
  dialogue: "对话",
  action: "动作",
  description: "描写",
  interiority: "心理",
  transition: "过渡",
  general: "通用",
};

interface RawHookLite {
  readonly id?: string;
  readonly title?: string;
  readonly text?: string;
  readonly description?: string;
}

export interface PrepInjectionPreviewCardProps {
  readonly preflightRaw: unknown;
  readonly loading?: boolean;
}

function extractPreviewModel(raw: unknown): {
  summary: WritePreflightRecallSummary | null;
  fallbackHooks: readonly string[];
  fallbackSkills: readonly string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { summary: null, fallbackHooks: [], fallbackSkills: [] };
  }
  const obj = raw as Record<string, unknown>;
  const data = (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
    ? obj.data
    : obj) as Record<string, unknown>;

  const summary = data.recallSummary && typeof data.recallSummary === "object" && !Array.isArray(data.recallSummary)
    ? (data.recallSummary as WritePreflightRecallSummary)
    : null;

  const due = Array.isArray(data.dueForeshadows) ? (data.dueForeshadows as RawHookLite[]) : [];
  const open = Array.isArray(data.openHooksForChapter) ? (data.openHooksForChapter as RawHookLite[]) : [];
  const fallbackHooks = [...new Set(
    [...due, ...open]
      .map((h) => (h?.title ?? h?.text ?? h?.description ?? "").trim())
      .filter(Boolean),
  )].slice(0, 8);

  const reqSkills = Array.isArray(data.requiredSkillAcknowledgements)
    ? (data.requiredSkillAcknowledgements as Array<{ name?: string; slug?: string }>)
    : [];
  const fallbackSkills = reqSkills
    .map((s) => (s?.name ?? s?.slug ?? "").trim())
    .filter(Boolean);

  return { summary, fallbackHooks, fallbackSkills };
}

export function PrepInjectionPreviewCard({ preflightRaw, loading = false }: PrepInjectionPreviewCardProps) {
  const [expanded, setExpanded] = useState(true);
  const { summary, fallbackHooks, fallbackSkills } = extractPreviewModel(preflightRaw);

  const estimatedTokens = summary?.estimatedTokens ?? 0;
  const maxTokens = summary?.maxTokens ?? 24_000;
  const ratio = maxTokens > 0 ? Math.min(100, Math.round((estimatedTokens / maxTokens) * 100)) : 0;
  const hasTrimAlert = (summary?.droppedCardIds.length ?? 0) > 0 || (summary?.trimWarnings.length ?? 0) > 0;

  const activeChannels = (summary?.channels ?? []).filter((ch) => ch.injectedTokens > 0 || ch.cardCount > 0);
  const hookTitles = summary && summary.hooks.length > 0
    ? summary.hooks.map((h) => h.title)
    : fallbackHooks;
  const skillItems = summary && summary.activeSkills.length > 0
    ? summary.activeSkills.map((s) => s.name)
    : fallbackSkills;

  return (
    <section
      className="rounded-lg border border-border bg-card p-3.5 space-y-2.5"
      data-testid="prep-injection-xray-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left"
        data-testid="prep-injection-xray-toggle"
      >
        <div className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <Eye className="size-3.5 text-primary" />
          <h3 className="text-xs font-semibold text-foreground">本章 AI 注入透视</h3>
          {hasTrimAlert ? (
            <Badge variant="outline" className="h-4 border-warning/40 bg-warning/10 px-1.5 text-2xs text-warning">
              存在裁剪提醒
            </Badge>
          ) : null}
        </div>
        <span className="text-2xs tabular-nums text-muted-foreground">
          {loading
            ? "计算中…"
            : summary
              ? `${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tok (${ratio}%)`
              : "等待预检召回"}
        </span>
      </button>

      {expanded ? (
        summary ? (
          <div className="space-y-3 pt-1">
            {/* Token 预算条 */}
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    ratio >= 90 ? "bg-destructive" : ratio >= 75 ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${Math.max(2, ratio)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-2xs text-muted-foreground">
                <span>
                  召回依据：{summary.basis === "sceneSpec" ? "结构化蓝图" : "本章写作目标"}
                </span>
                <span>
                  声线 {summary.voices.length} · 范文 {summary.samples.length} · 伏笔 {hookTitles.length} · 技能 {skillItems.length}
                </span>
              </div>
            </div>

            {/* 裁剪与超预算告警 */}
            {hasTrimAlert ? (
              <div
                className="rounded-md border border-warning/40 bg-warning/10 p-2 text-2xs text-warning space-y-1"
                data-testid="prep-injection-trim-alert"
              >
                <div className="inline-flex items-center gap-1 font-semibold">
                  <AlertTriangle className="size-3 shrink-0" />
                  <span>
                    预算裁剪提醒
                    {summary.droppedCardIds.length > 0 ? `（丢弃 ${summary.droppedCardIds.length} 张卡）` : ""}
                    {summary.degradedCount > 0 ? `（降档 ${summary.degradedCount} 张卡）` : ""}
                  </span>
                </div>
                <ul className="space-y-0.5 text-foreground/90">
                  {summary.trimWarnings.slice(0, 4).map((warn, idx) => (
                    <li key={idx} className="truncate">• {warn}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* 各通道 Token 分布 */}
            {activeChannels.length > 0 ? (
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                  <Cpu className="size-3" />
                  <span>活跃记忆通道分布 ({activeChannels.length})</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {activeChannels.map((ch) => (
                    <div
                      key={ch.channel}
                      className="flex items-center justify-between gap-1 rounded border border-border/60 bg-background/60 px-2 py-1 text-2xs"
                    >
                      <span className="truncate text-foreground">
                        {CHANNEL_LABELS[ch.channel] ?? ch.channel}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {ch.cardCount}卡 · {(ch.injectedTokens || ch.estimatedTokens).toLocaleString()}t
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 角色声线 */}
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                <Mic className="size-3" />
                <span>角色声线注入 ({summary.voices.length})</span>
              </div>
              {summary.voices.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {summary.voices.map((v) => (
                    <span
                      key={v.name}
                      className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/60 px-2 py-0.5 text-2xs text-foreground"
                    >
                      <span className="font-medium">{v.name}</span>
                      {v.confirmedFields.length > 0 ? (
                        <span className="text-muted-foreground">({v.confirmedFields.join("/")})</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  暂未命中已确认角色声线（可在指令中写明出场角色名，或确认角色卡声线）。
                </p>
              )}
            </div>

            {/* 文风范文 */}
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                <Sparkles className="size-3" />
                <span>文风范文锚点 ({summary.samples.length})</span>
              </div>
              {summary.samples.length > 0 ? (
                <ul className="space-y-1">
                  {summary.samples.map((smp) => (
                    <li
                      key={smp.key}
                      className="flex items-center justify-between gap-1.5 rounded border border-border/60 bg-background/60 px-2 py-1 text-2xs"
                    >
                      <span className="truncate text-foreground">
                        {smp.sourceTitle || smp.key} · {SCENE_TYPE_LABELS[smp.sceneType] ?? smp.sceneType}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {smp.match === "pinned" ? (
                          <Badge className="h-4 px-1 text-2xs">点选置顶</Badge>
                        ) : null}
                        {smp.droppedInPacking ? (
                          <span className="text-destructive">被预算裁掉</span>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">{smp.estimatedTokens}t</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-2xs text-muted-foreground">本章未注入范文示例。</p>
              )}
            </div>

            {/* 伏笔与写作技能 */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                  <Tag className="size-3" />
                  <span>召回伏笔 ({hookTitles.length})</span>
                </div>
                {hookTitles.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {hookTitles.slice(0, 6).map((title, i) => (
                      <span
                        key={`${title}-${i}`}
                        className="max-w-full truncate rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-2xs text-foreground"
                      >
                        {title}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-2xs text-muted-foreground">无活跃伏笔</p>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-2xs font-medium text-muted-foreground">
                  生效 Writing Skills ({skillItems.length})
                </div>
                {skillItems.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {skillItems.slice(0, 6).map((name) => (
                      <span
                        key={name}
                        className="max-w-full truncate rounded border border-primary/30 bg-primary/8 px-1.5 py-0.5 text-2xs text-primary"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-2xs text-muted-foreground">未启用写作技能</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 pt-1 text-2xs text-muted-foreground">
            <p>当前通道尚未返回详细 Token 切片，基础预检摘录：</p>
            <p>
              待跟进伏笔 {fallbackHooks.length} 条 · 相关写作技能 {fallbackSkills.length} 项
            </p>
          </div>
        )
      ) : null}
    </section>
  );
}
