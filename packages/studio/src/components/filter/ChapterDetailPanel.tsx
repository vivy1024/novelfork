import { AiTasteBadge } from "./AiTasteBadge";
import type { StoredFilterReportView } from "./types";

export function ChapterDetailPanel({ report }: { report: StoredFilterReportView }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/50 bg-background/70 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">第 {report.chapterNumber} 章 AI 味详情</h3>
        <AiTasteBadge score={report.aiTasteScore} level={report.level} />
      </div>
      <div className="text-xs text-muted-foreground">PGI：{report.details.pgiUsed ? "已使用" : "未使用"}</div>
      <div className="space-y-2">
        {(report.details.hits ?? []).map((hit) => (
          <article key={hit.ruleId} className="rounded-xl border border-border/40 p-3">
            <div className="font-bold">{hit.name}</div>
            <div className="text-xs text-muted-foreground">{hit.ruleId} · {hit.severity}</div>
            <div className="mt-2 text-sm">{hit.spans.map((span) => span.matched).join("、")}</div>
            {hit.suggestion && <div className="mt-2 text-sm text-primary">{hit.suggestion}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
