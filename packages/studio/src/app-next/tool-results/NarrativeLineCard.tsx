import { AlertTriangle, GitBranch, Info, Link2, Swords, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { ArtifactOpenButton } from "./ArtifactOpenButton";
import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getString, getToolResultArtifact, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

type WarningTone = "info" | "warning" | "critical";

interface WarningRow {
  readonly key: string;
  readonly severity: WarningTone;
  readonly summary: string;
}

interface ThreadRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readWarnings(value: unknown): WarningRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const summary = getString(record.summary);
    if (!summary) return [];
    const severity = record.severity === "critical" ? "critical" : record.severity === "warning" ? "warning" : "info";
    return [{ key: getString(record.id, `warning-${index}`), severity, summary }];
  });
}

function readThreads(value: unknown): ThreadRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = getString(record.title);
    if (!title) return [];
    return [{ id: getString(record.id, `thread-${index}`), title, status: getString(record.status) }];
  });
}

const FORESHADOW_STATUS_LABEL: Record<string, string> = {
  open: "待回收",
  due: "已到回收窗口",
  "paid-off": "已兑现",
  abandoned: "已放弃",
};

const CONFLICT_STATUS_LABEL: Record<string, string> = {
  open: "进行中",
  escalating: "升级中",
  paused: "搁置",
  resolved: "已解决",
};

function WarningIcon({ severity }: { severity: WarningTone }) {
  if (severity === "critical") return <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  if (severity === "warning") return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-foreground" />;
  return <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
}

/** narrative.read_line 快照卡：叙事线是由权威源计算得出的只读视图，重点看结构规模与告警。 */
export const NarrativeLineCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const { result, onOpenArtifact } = context;
  const data = asRecord(getToolResultData(result));
  if (!data) return null;

  const lines = Array.isArray(data.lines) ? data.lines : [];
  const mainLine = asRecord(lines[0]);
  const title = getString(mainLine?.title, "叙事线快照");
  const nodeCount = countOf(data.nodes);
  const edgeCount = countOf(data.edges);
  const beatCount = countOf(data.beats);
  const foreshadow = readThreads(data.foreshadowThreads);
  const conflicts = readThreads(data.conflictThreads);
  const warnings = readWarnings(data.warnings);
  const openForeshadow = foreshadow.filter((thread) => thread.status === "open" || thread.status === "due");
  const artifact = getToolResultArtifact(result);

  return (
    <ToolResultSurface
      testId="tool-result-narrative"
      title={title}
      icon={<GitBranch className="size-4 text-primary" />}
      meta={warnings.length > 0 ? <Badge variant="outline">{warnings.length} 条告警</Badge> : undefined}
      footer={artifact && onOpenArtifact ? <ArtifactOpenButton result={result} onOpenArtifact={onOpenArtifact} /> : undefined}
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>节点 {nodeCount}</span>
        <span>关系 {edgeCount}</span>
        {beatCount > 0 && <span>节拍 {beatCount}</span>}
      </div>

      {openForeshadow.length > 0 && (
        <details className="text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 text-foreground">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            未回收伏笔 {openForeshadow.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-5">
            {openForeshadow.map((thread) => (
              <li key={thread.id} className="text-muted-foreground">
                {thread.title}<span className="ml-1">· {FORESHADOW_STATUS_LABEL[thread.status] ?? thread.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {conflicts.length > 0 && (
        <details className="text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 text-foreground">
            <Swords className="size-3.5 shrink-0 text-muted-foreground" />
            冲突线 {conflicts.length}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-5">
            {conflicts.map((thread) => (
              <li key={thread.id} className="text-muted-foreground">
                {thread.title}<span className="ml-1">· {CONFLICT_STATUS_LABEL[thread.status] ?? thread.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {warnings.length > 0 && (
        <>
          <Separator />
          <ul className="flex flex-col gap-1">
            {warnings.map((warning) => (
              <li key={warning.key} className="flex items-start gap-1.5 text-xs">
                <WarningIcon severity={warning.severity} />
                <span className="min-w-0 text-muted-foreground">{warning.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ToolResultSurface>
  );
};
