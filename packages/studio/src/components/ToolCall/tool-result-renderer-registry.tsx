import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, FileText, HelpCircle, LoaderCircle, Map, PenLine, Sparkles } from "lucide-react";

import type {
  CanvasArtifact,
  GuidedGenerationPlan,
  GuidedQuestion,
  JingweiMutationPreview,
  ToolConfirmationDecision,
} from "@/shared/agent-native-workspace";
import type { ToolCall } from "@/shared/session-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getToolCallStatusLabel } from "./tool-call-utils";

export interface ToolResultRendererProps {
  toolCall: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
  onOpenCanvas?: (artifact: CanvasArtifact) => void;
  onConfirm?: (decision: ToolConfirmationDecision) => void;
}

export type ToolResultRenderer = (props: ToolResultRendererProps) => ReactNode;

const TOOL_NAME_RENDERERS: Readonly<Record<string, string>> = {
  "cockpit.get_snapshot": "cockpit.snapshot",
  "cockpit.list_open_hooks": "cockpit.openHooks",
  "questionnaire.start": "guided.questions",
  "guided.enter": "guided.questions",
  "guided.answer_question": "guided.questions",
  "pgi.generate_questions": "pgi.questions",
  "guided.exit": "guided.plan",
  "candidate.create_chapter": "candidate.created",
  "questionnaire.submit_response": "jingwei.mutationPreview",
};

const RENDERERS: Readonly<Record<string, ToolResultRenderer>> = {
  "cockpit.snapshot": CockpitSnapshotCard,
  "cockpit.openHooks": OpenHooksCard,
  "guided.questions": GuidedQuestionsCard,
  "questionnaire.questions": GuidedQuestionsCard,
  "pgi.questions": PgiQuestionsCard,
  "guided.plan": GuidedGenerationPlanCard,
  "candidate.created": CandidateCreatedCard,
  "jingwei.mutationPreview": JingweiMutationPreviewCard,
};

export function getToolResultRenderer(toolCall: ToolCall): ToolResultRenderer | undefined {
  const rendererId = getToolResultRendererId(toolCall);
  return rendererId ? RENDERERS[rendererId] : undefined;
}

export function getToolResultRendererId(toolCall: ToolCall): string | undefined {
  const result = asRecord(toolCall.result);
  const metadata = asRecord(result?.metadata);
  const renderer = stringValue(result?.renderer) ?? stringValue(metadata?.renderer) ?? toolCall.renderer;
  if (renderer) return renderer;

  return TOOL_NAME_RENDERERS[toolCall.toolName.trim().toLowerCase()];
}

export function CockpitSnapshotCard({ toolCall, className, onOpenCanvas }: ToolResultRendererProps) {
  const result = asRecord(toolCall.result);
  const snapshot = asRecord(result?.data) ?? result ?? {};
  const book = asRecord(snapshot.book);
  const progress = asRecord(snapshot.progress);
  const focus = asRecord(snapshot.currentFocus);
  const recentSummaries = readArray(asRecord(snapshot.recentChapterSummaries)?.items);
  const openHooks = readArray(asRecord(snapshot.openHooks)?.items);
  const recentCandidates = readArray(asRecord(snapshot.recentCandidates)?.items);
  const risks = readArray(asRecord(snapshot.riskCards)?.items);
  const modelStatus = asRecord(snapshot.modelStatus);
  const artifact = extractArtifact(toolCall);
  const targetChapters = numberValue(progress?.targetChapters);
  const chapterCount = numberValue(progress?.chapterCount) ?? 0;
  const todayWords = numberValue(progress?.todayWords) ?? 0;
  const dailyTarget = numberValue(progress?.dailyTarget) ?? 0;

  return (
    <RendererCard
      className={className}
      data-testid="cockpit-snapshot-card"
      icon={<Sparkles className="size-4" />}
      title="驾驶舱快照"
      toolCall={toolCall}
      tone={toolCall.status === "error" ? "error" : "default"}
      action={artifact ? { label: "在画布打开", onClick: () => onOpenCanvas?.(artifact) } : undefined}
    >
      <div className="flex flex-wrap gap-2">
        <Metric label="书籍" value={stringValue(book?.title) ?? "未接入书籍"} hint={[stringValue(book?.genre), stringValue(book?.platform)].filter(Boolean).join(" · ")} />
        <Metric label="章节进度" value={`${chapterCount}${targetChapters ? ` / ${targetChapters}` : ""} 章`} hint={`${numberValue(progress?.totalWords) ?? 0} 字 · 已通过 ${numberValue(progress?.approvedChapters) ?? 0} 章`} />
        <Metric label="日更" value={`今日 ${todayWords} / ${dailyTarget} 字`} hint={`连续 ${numberValue(progress?.streak) ?? 0} 天 · 本周 ${numberValue(progress?.weeklyWords) ?? 0} 字`} />
        <Metric label="模型" value={modelStatus ? (modelStatus.hasUsableModel ? "可用" : "未配置") : "未接入"} hint={[stringValue(modelStatus?.defaultProvider), stringValue(modelStatus?.defaultModel), modelStatus?.supportsToolUse === true ? "支持工具" : undefined].filter(Boolean).join(" · ")} />
      </div>

      <Section title="当前焦点" emptyText={stringValue(focus?.reason) ?? "未接入 / 无数据"}>
        {stringValue(focus?.content) ? <p className="line-clamp-3 text-xs leading-5 text-foreground">{stringValue(focus?.content)}</p> : null}
      </Section>

      <div className="space-y-3">
        <ListSection title="最近章节摘要" items={recentSummaries} emptyText={stringValue(asRecord(snapshot.recentChapterSummaries)?.reason) ?? "暂无章节摘要。"} renderItem={(item) => (
          <>
            <span className="font-medium">第{numberValue(asRecord(item)?.number) ?? "?"}章</span>
            <span>{stringValue(asRecord(item)?.summary) ?? "无摘要"}</span>
          </>
        )} />
        <ListSection title="待回收伏笔" items={openHooks} emptyText={stringValue(asRecord(snapshot.openHooks)?.reason) ?? "暂无开放伏笔。"} renderItem={(item) => (
          <>
            <span>{stringValue(asRecord(item)?.text) ?? "未命名伏笔"}</span>
            <Badge variant="outline">{formatHookStatus(stringValue(asRecord(item)?.status))}</Badge>
          </>
        )} />
        <ListSection title="最近候选稿" items={recentCandidates} emptyText={stringValue(asRecord(snapshot.recentCandidates)?.reason) ?? "暂无候选稿。"} renderItem={(item) => (
          <>
            <span>{stringValue(asRecord(item)?.title) ?? stringValue(asRecord(item)?.id) ?? "未命名候选稿"}</span>
            <Badge variant="outline">{stringValue(asRecord(item)?.status) ?? "candidate"}</Badge>
          </>
        )} />
        <ListSection title="风险章节" items={risks} emptyText={stringValue(asRecord(snapshot.riskCards)?.reason) ?? "暂无驾驶舱风险。"} renderItem={(item) => (
          <>
            <span>{stringValue(asRecord(item)?.title) ?? "未命名风险"}</span>
            <span className="text-muted-foreground">{stringValue(asRecord(item)?.detail)}</span>
          </>
        )} />
      </div>
    </RendererCard>
  );
}

export function OpenHooksCard({ toolCall, className }: ToolResultRendererProps) {
  const data = extractData(toolCall);
  const items = readArray(data.items ?? asRecord(data.openHooks)?.items);
  return (
    <RendererCard
      className={className}
      data-testid="open-hooks-card"
      icon={<HelpCircle className="size-4" />}
      title="开放伏笔"
      toolCall={toolCall}
      tone={toolCall.status === "error" ? "error" : "default"}
    >
      <ListSection title={`${items.length} 条待处理`} items={items} emptyText={stringValue(data.reason) ?? "暂无开放伏笔。"} renderItem={(item) => {
        const record = asRecord(item);
        return (
          <>
            <span>{stringValue(record?.text) ?? stringValue(record?.summary) ?? "未命名伏笔"}</span>
            {stringValue(record?.status) ? <Badge variant="outline">{formatHookStatus(stringValue(record?.status))}</Badge> : null}
          </>
        );
      }} />
    </RendererCard>
  );
}

export function GuidedQuestionsCard({ toolCall, className }: ToolResultRendererProps) {
  const data = extractData(toolCall);
  const state = asRecord(data.state) ?? asRecord(asRecord(asRecord(toolCall.result)?.guided)?.state);
  const questions = readArray(data.questions ?? state?.questions);
  const goal = stringValue(data.goal) ?? stringValue(state?.goal);
  return (
    <RendererCard
      className={className}
      data-testid="guided-questions-card"
      icon={<HelpCircle className="size-4" />}
      title="引导式问题"
      toolCall={toolCall}
      tone={toolCall.status === "error" ? "error" : "default"}
    >
      {goal ? <p className="text-xs text-muted-foreground">目标：{goal}</p> : null}
      <QuestionList questions={questions} emptyText={stringValue(data.reason) ?? "暂无需要补充的问题。"} />
    </RendererCard>
  );
}

export function PgiQuestionsCard({ toolCall, className }: ToolResultRendererProps) {
  const data = extractData(toolCall);
  const questions = readArray(data.questions ?? asRecord(asRecord(toolCall.result)?.pgi)?.questions);
  const heuristics = readArray(data.heuristicsTriggered).filter(isString);
  return (
    <RendererCard
      className={className}
      data-testid="pgi-questions-card"
      icon={<PenLine className="size-4" />}
      title="生成前追问"
      toolCall={toolCall}
      tone={toolCall.status === "error" ? "error" : "default"}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {numberValue(data.chapterNumber) ? <Badge variant="outline">第 {numberValue(data.chapterNumber)} 章</Badge> : null}
        {heuristics.map((heuristic) => <Badge key={heuristic} variant="secondary">{heuristic}</Badge>)}
      </div>
      <QuestionList questions={questions} emptyText={stringValue(data.reason) ?? "未触发生成前追问。"} />
    </RendererCard>
  );
}

export function GuidedGenerationPlanCard({ toolCall, className, onOpenCanvas }: ToolResultRendererProps) {
  const result = asRecord(toolCall.result);
  const data = extractData(toolCall);
  const guided = asRecord(result?.guided);
  const state = asRecord(data.state) ?? asRecord(guided?.state);
  const plan = (asRecord(data.plan) ?? asRecord(guided?.plan) ?? asRecord(state?.plan)) as GuidedGenerationPlan | Record<string, unknown> | undefined;
  const mutations = readArray(plan?.proposedJingweiMutations);
  const sources = readArray(plan?.contextSources);
  const candidate = asRecord(plan?.proposedCandidate);
  const pendingConfirmation = toolCall.status === "pending" || data.status === "pending-confirmation" || Boolean(result?.confirmation);
  const artifact = extractArtifact(toolCall);
  return (
    <RendererCard
      className={className}
      data-testid="guided-generation-plan-card"
      icon={<FileText className="size-4" />}
      title="引导式生成计划"
      toolCall={toolCall}
      tone={toolCall.status === "error" ? "error" : pendingConfirmation ? "warning" : "default"}
      action={artifact ? { label: "在画布打开", onClick: () => onOpenCanvas?.(artifact) } : undefined}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{stringValue(plan?.title) ?? "未命名计划"}</h4>
          {pendingConfirmation ? <Badge variant="outline">待作者确认</Badge> : null}
          {stringValue(data.status) ? <Badge variant="secondary">{formatStatus(String(data.status))}</Badge> : null}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{stringValue(plan?.contextSummary) ?? stringValue(plan?.goal) ?? toolCall.summary ?? "暂无计划摘要。"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Metric label="上下文来源" value={`${sources.length} 项`} hint={sources.map((source) => stringValue(asRecord(source)?.title)).filter(Boolean).slice(0, 2).join(" · ")} />
        <Metric label="经纬变更" value={`${mutations.length} 项`} hint={mutations.map((mutation) => stringValue(asRecord(mutation)?.summary)).filter(Boolean).slice(0, 1).join(" · ")} />
        <Metric label="候选稿" value={candidate ? (stringValue(candidate.title) ?? `第 ${numberValue(candidate.chapterNumber) ?? "?"} 章`) : "未计划"} hint={stringValue(candidate?.intent)} />
      </div>
      <ListSection title="风险与确认项" items={[...readArray(plan?.risks), ...readArray(plan?.confirmationItems)]} emptyText="暂无风险或确认项。" renderItem={(item) => <span>{String(item)}</span>} />
    </RendererCard>
  );
}

export function CandidateCreatedCard({ toolCall, className, onOpenCanvas }: ToolResultRendererProps) {
  const result = asRecord(toolCall.result);
  const data = extractData(toolCall);
  const candidate = asRecord(data.candidate) ?? data;
  const artifact = extractArtifact(toolCall);
  const metadata = asRecord(candidate.metadata);
  const statusReason = stringValue(data.reason) ?? stringValue(result?.error) ?? toolCall.error;
  return (
    <RendererCard
      className={className}
      data-testid="candidate-created-card"
      icon={<FileText className="size-4" />}
      title="候选稿产物"
      toolCall={toolCall}
      tone={toolCall.status === "error" || result?.ok === false ? "error" : "default"}
      action={artifact ? { label: "在画布打开", onClick: () => onOpenCanvas?.(artifact) } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{stringValue(candidate.title) ?? stringValue(artifact?.title) ?? "未命名候选稿"}</h4>
        {numberValue(candidate.chapterNumber) ? <Badge variant="outline">第 {numberValue(candidate.chapterNumber)} 章</Badge> : null}
        {metadata?.nonDestructive === true || data.status === "candidate" ? <Badge variant="secondary">非破坏性候选稿</Badge> : null}
      </div>
      {stringValue(candidate.content) ? <p className="line-clamp-3 rounded-lg border border-border/60 bg-muted/30 p-2 text-xs leading-5 text-muted-foreground">{stringValue(candidate.content)}</p> : null}
      {statusReason ? <p className={cn("text-xs leading-5", toolCall.status === "error" || result?.ok === false ? "text-destructive" : "text-muted-foreground")}>{statusReason}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Metric label="ID" value={stringValue(candidate.id) ?? stringValue(artifact?.id) ?? "未返回"} />
        <Metric label="状态" value={stringValue(candidate.status) ?? stringValue(data.status) ?? "unknown"} />
        <Metric label="来源" value={stringValue(candidate.source) ?? "session tool"} />
      </div>
    </RendererCard>
  );
}

export function JingweiMutationPreviewCard({ toolCall, className, onOpenCanvas }: ToolResultRendererProps) {
  const data = extractData(toolCall);
  const artifact = extractArtifact(toolCall);
  const mutations = readMutations(data);
  return (
    <RendererCard
      className={className}
      data-testid="jingwei-mutation-preview-card"
      icon={<Map className="size-4" />}
      title="经纬变更预览"
      toolCall={toolCall}
      tone={toolCall.status === "error" ? "error" : "default"}
      action={artifact ? { label: "在画布打开", onClick: () => onOpenCanvas?.(artifact) } : undefined}
    >
      <div className="flex flex-wrap gap-2">
        <Metric label="状态" value={stringValue(data.status) ?? "unknown"} />
        <Metric label="目标对象" value={stringValue(data.targetObjectId) ?? stringValue(data.target) ?? "未返回"} />
        <Metric label="变更数" value={`${mutations.length} 项`} />
      </div>
      <ListSection title="拟写入 / 已写入变更" items={mutations} emptyText={stringValue(data.reason) ?? "未返回经纬变更明细。"} renderItem={(item) => {
        const mutation = asRecord(item);
        return (
          <>
            <Badge variant="outline">{stringValue(mutation?.operation) ?? "update"}</Badge>
            <span>{stringValue(mutation?.summary) ?? stringValue(mutation?.target) ?? "未命名变更"}</span>
          </>
        );
      }} />
    </RendererCard>
  );
}

function RendererCard({
  children,
  className,
  icon,
  title,
  toolCall,
  tone = "default",
  action,
  "data-testid": testId,
}: {
  children: ReactNode;
  className?: string;
  icon: ReactNode;
  title: string;
  toolCall: ToolCall;
  tone?: "default" | "warning" | "error";
  action?: { label: string; onClick: () => void };
  "data-testid": string;
}) {
  const status = toolCall.status ?? "success";
  return (
    <section
      data-testid={testId}
      className={cn(
        "space-y-3 rounded-xl border bg-card/80 p-3 text-sm shadow-none",
        tone === "error" ? "border-destructive/40 bg-destructive/5" : tone === "warning" ? "border-amber-500/30 bg-amber-500/5" : "border-border/70",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="rounded-lg border border-border/70 bg-muted/50 p-2 text-muted-foreground">{icon}</div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              <RendererStatusBadge status={status} />
              {toolCall.duration !== undefined ? <Badge variant="outline">{Math.round(toolCall.duration)}ms</Badge> : null}
            </div>
            {toolCall.summary ? <p className="text-xs leading-5 text-muted-foreground">{toolCall.summary}</p> : null}
          </div>
        </div>
        {action ? (
          <Button type="button" variant="outline" size="xs" onClick={action.onClick}>
            <ExternalLink className="size-3.5" />
            {action.label}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function RendererStatusBadge({ status }: { status: NonNullable<ToolCall["status"]> }) {
  const icon = status === "pending"
    ? <CircleDashed className="size-3" />
    : status === "running"
      ? <LoaderCircle className="size-3 animate-spin" />
      : status === "error"
        ? <AlertTriangle className="size-3" />
        : <CheckCircle2 className="size-3" />;

  return <Badge variant={status === "error" ? "destructive" : status === "success" ? "secondary" : "outline"} className="gap-1">{icon}{getToolCallStatusLabel(status)}</Badge>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-foreground" title={value}>{value}</div>
      {hint ? <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function Section({ title, children, emptyText }: { title: string; children: ReactNode; emptyText: string }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</h4>
      {children || <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">{emptyText}</p>}
    </section>
  );
}

function ListSection({
  title,
  items,
  emptyText,
  renderItem,
}: {
  title: string;
  items: readonly unknown[];
  emptyText: string;
  renderItem: (item: unknown, index: number) => ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</h4>
      {items.length > 0 ? (
        <div className="space-y-1.5">
          {items.slice(0, 5).map((item, index) => (
            <div key={stableItemKey(item, index)} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-xs">
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">{emptyText}</p>
      )}
    </section>
  );
}

function QuestionList({ questions, emptyText }: { questions: readonly unknown[]; emptyText: string }) {
  return (
    <ListSection title={`${questions.length} 个问题`} items={questions} emptyText={emptyText} renderItem={(item) => {
      const question = asRecord(item) as (Partial<GuidedQuestion> & Record<string, unknown>) | undefined;
      return (
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{stringValue(question?.prompt) ?? "未命名问题"}</span>
            {question?.required === false ? <Badge variant="outline">可跳过</Badge> : <Badge variant="secondary">必答</Badge>}
          </div>
          {stringValue(question?.reason) ? <p className="text-[11px] leading-4 text-muted-foreground">原因：{stringValue(question?.reason)}</p> : null}
          {stringValue(question?.aiSuggestion) ? <p className="text-[11px] leading-4 text-muted-foreground">AI 建议：{stringValue(question?.aiSuggestion)}</p> : null}
        </div>
      );
    }} />
  );
}

function extractData(toolCall: ToolCall): Record<string, unknown> {
  const result = asRecord(toolCall.result);
  const data = asRecord(result?.data);
  return data ?? result ?? {};
}

function extractArtifact(toolCall: ToolCall): CanvasArtifact | undefined {
  const result = asRecord(toolCall.result);
  const metadata = asRecord(result?.metadata);
  return (asRecord(result?.artifact) ?? asRecord(metadata?.artifact) ?? asRecord(toolCall.artifact)) as CanvasArtifact | undefined;
}

function readMutations(data: Record<string, unknown>): readonly unknown[] {
  const direct = readArray(data.mutations);
  if (direct.length > 0) return direct;
  const preview = readArray(data.proposedJingweiMutations);
  if (preview.length > 0) return preview;
  const response = asRecord(data.response);
  if (response && (data.targetObjectId || response.id)) {
    return [{ target: stringValue(data.targetObjectId) ?? stringValue(response.id) ?? "unknown", operation: "update", summary: `问卷回答 ${stringValue(response.id) ?? "response"} 已写入经纬对象` } satisfies JingweiMutationPreview];
  }
  return [];
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function formatHookStatus(status: string | undefined) {
  switch (status) {
    case "payoff-due":
      return "临近回收";
    case "expired-risk":
      return "逾期风险";
    case "resolved":
      return "已回收";
    case "frozen":
      return "冻结";
    case "open":
    default:
      return "开放";
  }
}

function formatStatus(status: string) {
  switch (status) {
    case "pending-confirmation":
      return "待确认";
    case "executing":
      return "执行中";
    case "rejected":
      return "已拒绝";
    case "approved":
      return "已批准";
    default:
      return status;
  }
}

function stableItemKey(item: unknown, index: number) {
  const record = asRecord(item);
  return stringValue(record?.id) ?? stringValue(record?.title) ?? stringValue(record?.prompt) ?? `${index}`;
}
