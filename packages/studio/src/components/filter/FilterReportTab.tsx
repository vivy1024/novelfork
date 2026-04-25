import { AiTasteBadge } from "./AiTasteBadge";
import type { StoredFilterReportView } from "./types";

function average(reports: StoredFilterReportView[]): number {
  if (reports.length === 0) return 0;
  return Math.round(reports.reduce((sum, report) => sum + report.aiTasteScore, 0) / reports.length);
}

export function FilterReportTab({ reports }: { reports: StoredFilterReportView[] }) {
  const pgiReports = reports.filter((report) => report.details.pgiUsed);
  const ruleCounts = new Map<string, number>();
  for (const report of reports) {
    for (const hit of report.details.hits ?? []) {
      ruleCounts.set(hit.ruleId, (ruleCounts.get(hit.ruleId) ?? 0) + hit.spans.length);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border/50 bg-card/70 p-4">
      <h2 className="font-serif text-xl font-semibold">AI 味报告</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-background/70 p-3">全书平均分：{average(reports)}</div>
        <div className="rounded-xl bg-background/70 p-3">PGI 章节平均：{average(pgiReports)}（{pgiReports.length} 章）</div>
        <div className="rounded-xl bg-background/70 p-3">规则触发：{ruleCounts.size}</div>
      </div>
      <div className="space-y-2">
        {reports.map((report) => (
          <div key={report.id} className="flex items-center justify-between rounded-xl border border-border/40 p-3">
            <span>第 {report.chapterNumber} 章</span>
            <AiTasteBadge score={report.aiTasteScore} level={report.level} />
          </div>
        ))}
      </div>
    </section>
  );
}
