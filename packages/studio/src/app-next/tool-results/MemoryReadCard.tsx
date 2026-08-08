import { AlertTriangle, BrainCircuit } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getStringArray, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

interface CardRow {
  readonly key: string;
  readonly title: string;
  readonly channel: string;
  readonly brief: string;
  readonly reason: string;
  readonly content: string;
  readonly tokens: number | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  hard: "硬约束",
  state: "状态",
  timeline: "时间线",
  relationship: "关系",
  hooks: "伏笔",
  facts: "事实",
  style: "文风",
  semantic: "语义",
};

function readCards(value: unknown): CardRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = getString(record.title);
    if (!title) return [];
    return [{
      key: getString(record.id, `card-${index}`),
      title,
      channel: getString(record.channel),
      brief: getString(record.brief),
      reason: getString(record.reason),
      content: getString(record.content),
      tokens: getNumber(record.estimatedTokens),
    }];
  });
}

/** memory.read 召回卡：一眼看有多少 ContextCard、耗多少 token 与召回告警，每张卡的正文可折叠。 */
export const MemoryReadCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const cards = readCards(data.cards);
  const diagnostics = asRecord(data.diagnostics);
  const totalTokens = getNumber(diagnostics?.totalEstimatedTokens);
  const warnings = getStringArray(data.warnings).length > 0
    ? getStringArray(data.warnings)
    : getStringArray(diagnostics?.warnings);

  return (
    <ToolResultSurface
      testId="tool-result-memory-read"
      title="叙事记忆召回"
      icon={<BrainCircuit className="size-4 text-primary" />}
      meta={`${cards.length} 张卡${totalTokens !== null ? ` · 约 ${totalTokens} tokens` : ""}`}
    >
      {warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="size-4 text-foreground" />
          <AlertTitle>召回提醒</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
              {warnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {cards.length === 0 ? (
        <p className="text-xs text-muted-foreground">本次召回没有命中任何 ContextCard。</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {cards.map((card) => (
            <li key={card.key} className="text-xs">
              <p className="flex flex-wrap items-center gap-2 text-foreground">
                {card.channel && <Badge variant="secondary">{CHANNEL_LABEL[card.channel] ?? card.channel}</Badge>}
                <span>{card.title}</span>
                {card.tokens !== null && <span className="text-muted-foreground">{card.tokens}t</span>}
              </p>
              {card.brief && <p className="text-muted-foreground">{card.brief}</p>}
              {card.reason && <p className="text-muted-foreground">召回理由：{card.reason}</p>}
              {card.content && card.content !== card.brief && (
                <details className="mt-0.5">
                  <summary className="cursor-pointer text-muted-foreground">展开正文</summary>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{card.content}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolResultSurface>
  );
};
