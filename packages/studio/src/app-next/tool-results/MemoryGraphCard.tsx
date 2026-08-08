import { Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface FactRow {
  readonly key: string;
  readonly triple: string;
  readonly category: string;
  readonly layer: string;
  readonly chapter: number | null;
  readonly evidence: string;
}

interface EventRow {
  readonly key: string;
  readonly triple: string;
  readonly eventType: string;
  readonly chapter: number | null;
  readonly risk: string;
  readonly status: string;
  readonly evidence: string;
}

const VIEW_LABEL: Record<string, string> = {
  relationship: "关系图",
  timeline: "时间线",
  character_arc: "角色弧线",
  foreshadowing: "伏笔网络",
  conflict: "矛盾地图",
  event_chain: "事件链",
  wave: "波场",
};

const LAYER_LABEL: Record<string, string> = { canon: "canon", dynamic: "动态", reference: "参考" };

function triple(record: Record<string, unknown>): string {
  return [getString(record.subject), getString(record.predicate), getString(record.object)].filter(Boolean).join(" · ");
}

function readFacts(value: unknown): FactRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const text = triple(record);
    if (!text) return [];
    return [{
      key: getString(record.id, `fact-${index}`),
      triple: text,
      category: getString(record.category),
      layer: getString(record.layer),
      chapter: getNumber(record.sourceChapter),
      evidence: getString(record.evidenceText),
    }];
  });
}

function readEvents(value: unknown): EventRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const text = triple(record);
    if (!text) return [];
    return [{
      key: getString(record.id, `event-${index}`),
      triple: text,
      eventType: getString(record.eventType),
      chapter: getNumber(record.chapterNumber),
      risk: getString(record.riskLevel),
      status: getString(record.status),
      evidence: getString(record.evidenceText),
    }];
  });
}

/** memory.graph 图谱卡：按视图列出动态事实与事件三元组，证据文本可折叠。只读，不改 Lore。 */
export const MemoryGraphCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const view = getString(data.view);
  const focusEntity = getString(data.focusEntity);
  const facts = readFacts(data.facts);
  const events = readEvents(data.events);

  return (
    <ToolResultSurface
      testId="tool-result-memory-graph"
      title={VIEW_LABEL[view] ?? "记忆图谱"}
      icon={<Network className="size-4 text-primary" />}
      meta={`${facts.length} 条事实 · ${events.length} 个事件`}
    >
      {focusEntity && <p className="text-xs text-muted-foreground">聚焦：{focusEntity}</p>}

      {facts.length > 0 && (
        <details className="text-xs" open>
          <summary className="cursor-pointer text-foreground">事实（{facts.length}）</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {facts.map((fact) => (
              <li key={fact.key}>
                <p className="flex flex-wrap items-center gap-1 text-foreground">
                  <span>{fact.triple}</span>
                  {fact.category && <Badge variant="outline">{fact.category}</Badge>}
                  {fact.layer && <Badge variant="secondary">{LAYER_LABEL[fact.layer] ?? fact.layer}</Badge>}
                  {fact.chapter !== null && <span className="text-muted-foreground">第{fact.chapter}章</span>}
                </p>
                {fact.evidence && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">证据</summary>
                    <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{fact.evidence}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {events.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-foreground">事件（{events.length}）</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {events.map((event) => (
              <li key={event.key}>
                <p className="flex flex-wrap items-center gap-1 text-foreground">
                  <span>{event.triple}</span>
                  {event.eventType && <Badge variant="outline">{event.eventType}</Badge>}
                  {event.chapter !== null && <span className="text-muted-foreground">第{event.chapter}章</span>}
                  {event.risk && <span className="text-muted-foreground">风险:{event.risk}</span>}
                  {event.status && <Badge variant="secondary">{event.status}</Badge>}
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
        </details>
      )}

      {facts.length === 0 && events.length === 0 && (
        <p className="text-xs text-muted-foreground">该视图下暂无可展示的事实或事件。</p>
      )}
    </ToolResultSurface>
  );
};
