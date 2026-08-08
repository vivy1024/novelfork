import { CheckCircle2, ListChecks, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface EventRow {
  readonly key: string;
  readonly triple: string;
  readonly eventType: string;
  readonly chapter: number | null;
  readonly risk: string;
  readonly status: string;
  readonly evidence: string;
}

function triple(record: Record<string, unknown>): string {
  return [getString(record.subject), getString(record.predicate), getString(record.object)].filter(Boolean).join(" · ");
}

function toEventRow(record: Record<string, unknown>, index: number): EventRow | null {
  const text = triple(record);
  if (!text) return null;
  return {
    key: getString(record.id, `event-${index}`),
    triple: text,
    eventType: getString(record.eventType),
    chapter: getNumber(record.chapterNumber),
    risk: getString(record.riskLevel),
    status: getString(record.status),
    evidence: getString(record.evidenceText),
  };
}

function readEvents(value: unknown): EventRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const row = toEventRow(record, index);
    return row ? [row] : [];
  });
}

const STATUS_LABEL: Record<string, string> = { pending: "待审", applied: "已写入", rejected: "已拒绝" };

/** memory.events 事件流卡：列出 Pending / 单条处理结果的事件三元组、风险等级与证据。 */
export const MemoryEventsCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const listRows = readEvents(data.events);
  const single = asRecord(data.event);
  const singleRow = single ? toEventRow(single, 0) : null;
  const rows = listRows.length > 0 ? listRows : singleRow ? [singleRow] : [];
  const reason = getString(data.reason);

  return (
    <ToolResultSurface
      testId="tool-result-memory-events"
      title="叙事事件"
      icon={<ListChecks className="size-4 text-primary" />}
      meta={`${rows.length} 个事件`}
    >
      {reason && <p className="text-xs text-muted-foreground">审批理由：{reason}</p>}

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">当前没有可展示的 NarrativeEvent。</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((event) => (
            <li key={event.key} className="text-xs">
              <p className="flex flex-wrap items-center gap-2 text-foreground">
                {event.status && (
                  <Badge variant={event.status === "rejected" ? "destructive" : event.status === "applied" ? "secondary" : "outline"}>
                    {event.status === "applied"
                      ? <CheckCircle2 data-icon="inline-start" />
                      : event.status === "rejected"
                        ? <XCircle data-icon="inline-start" />
                        : null}
                    {STATUS_LABEL[event.status] ?? event.status}
                  </Badge>
                )}
                <span>{event.triple}</span>
              </p>
              <p className="text-muted-foreground">
                {event.eventType && <span>[{event.eventType}]</span>}
                {event.chapter !== null && <span className="ml-1">第{event.chapter}章</span>}
                {event.risk && <span className="ml-1">风险:{event.risk}</span>}
              </p>
              {event.evidence && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">证据</summary>
                  <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{event.evidence}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolResultSurface>
  );
};
