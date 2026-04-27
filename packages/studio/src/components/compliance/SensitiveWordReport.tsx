import { useMemo, useState } from "react";

import type {
  BookSensitiveScanResult,
  SensitiveHit,
  SensitiveWordCategory,
  SensitiveWordSeverity,
} from "@vivy1024/novelfork-core/compliance";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SensitiveWordReportProps {
  readonly report: BookSensitiveScanResult;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
}

interface SensitiveHitRow {
  readonly id: string;
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly word: string;
  readonly category: SensitiveWordCategory;
  readonly severity: SensitiveWordSeverity;
  readonly count: number;
  readonly suggestion?: string;
  readonly context: string;
}

const SEVERITY_LABELS: Record<SensitiveWordSeverity, string> = {
  block: "block",
  warn: "warn",
  suggest: "suggest",
};

const SEVERITY_BADGE_VARIANTS: Record<SensitiveWordSeverity, "default" | "secondary" | "outline" | "destructive"> = {
  block: "destructive",
  warn: "secondary",
  suggest: "outline",
};

function flattenHits(report: BookSensitiveScanResult): SensitiveHitRow[] {
  const rows: SensitiveHitRow[] = [];

  for (const chapter of report.chapters) {
    for (const hit of chapter.hits) {
      rows.push({
        id: `${chapter.chapterNumber}-${hit.word}-${hit.category}-${hit.severity}`,
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.chapterTitle,
        word: hit.word,
        category: hit.category,
        severity: hit.severity,
        count: hit.count,
        suggestion: hit.suggestion,
        context: hit.positions[0]?.context ?? "",
      });
    }
  }

  return rows;
}

function highlightContext(context: string, word: string) {
  if (!context || !word || !context.includes(word)) {
    return <span>{context || "—"}</span>;
  }

  const parts = context.split(word);
  return (
    <span>
      {parts.map((part, index) => (
        <span key={`${word}-${index}`}>
          {part}
          {index < parts.length - 1 ? <mark className="rounded bg-amber-200 px-0.5 text-foreground">{word}</mark> : null}
        </span>
      ))}
    </span>
  );
}

export function SensitiveWordReport({ report, onJumpToChapter }: SensitiveWordReportProps) {
  const allRows = useMemo(() => flattenHits(report), [report]);
  const [severityFilter, setSeverityFilter] = useState<SensitiveWordSeverity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<SensitiveWordCategory | "all">("all");

  const categories = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.category))),
    [allRows],
  );

  const filteredRows = useMemo(
    () => allRows.filter((row) => {
      if (severityFilter !== "all" && row.severity !== severityFilter) {
        return false;
      }
      if (categoryFilter !== "all" && row.category !== categoryFilter) {
        return false;
      }
      return true;
    }),
    [allRows, severityFilter, categoryFilter],
  );

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <CardTitle>敏感词扫描结果</CardTitle>
            <CardDescription>敏感词命中 {allRows.length} 条</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="destructive">block {report.totalBlockCount}</Badge>
            <Badge variant="secondary">warn {report.totalWarnCount}</Badge>
            <Badge variant="outline">suggest {report.totalSuggestCount}</Badge>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={severityFilter === "all" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setSeverityFilter("all")}
            >
              全部严重等级
            </Button>
            {(["block", "warn", "suggest"] as const).map((severity) => (
              <Button
                key={severity}
                type="button"
                variant={severityFilter === severity ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSeverityFilter(severity)}
              >
                仅看 {SEVERITY_LABELS[severity]}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={categoryFilter === "all" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter("all")}
            >
              全部类别
            </Button>
            {categories.map((category) => (
              <Button
                key={category}
                type="button"
                variant={categoryFilter === category ? "secondary" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(category)}
              >
                仅看 {category}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <ScrollArea className="max-h-[480px] rounded-md border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>章节</TableHead>
                <TableHead>词条</TableHead>
                <TableHead>类别</TableHead>
                <TableHead>严重等级</TableHead>
                <TableHead>次数</TableHead>
                <TableHead>上下文</TableHead>
                <TableHead>建议</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length > 0 ? (
                filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">第 {row.chapterNumber} 章</div>
                        <div className="text-xs text-muted-foreground">{row.chapterTitle}</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{row.word}</TableCell>
                    <TableCell>{row.category}</TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_BADGE_VARIANTS[row.severity]}>{SEVERITY_LABELS[row.severity]}</Badge>
                    </TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                      {highlightContext(row.context, row.word)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.suggestion ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onJumpToChapter?.(row.chapterNumber)}
                      >
                        跳转到第 {row.chapterNumber} 章
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    当前筛选条件下没有命中。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
