import type { BookAiRatioReport, ChapterAiEstimate, SupportedPlatform } from "@vivy1024/novelfork-core/compliance";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AiRatioReportProps {
  readonly report: BookAiRatioReport;
}

const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  qidian: "起点中文网",
  jjwxc: "晋江文学城",
  fanqie: "番茄小说",
  qimao: "七猫小说",
  generic: "通用参考",
};

const LEVEL_LABELS: Record<BookAiRatioReport["overallLevel"], string> = {
  safe: "安全",
  caution: "关注",
  danger: "警告",
};

const LEVEL_BADGE_VARIANTS: Record<BookAiRatioReport["overallLevel"], "default" | "secondary" | "outline" | "destructive"> = {
  safe: "outline",
  caution: "secondary",
  danger: "destructive",
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getReferenceItems(report: BookAiRatioReport) {
  return [
    {
      key: "qidian",
      label: `${PLATFORM_LABELS.qidian} ${formatPercent(report.platformThresholds.qidian)}`,
      note: "100% 人工创作",
    },
    {
      key: "jjwxc",
      label: `${PLATFORM_LABELS.jjwxc} ${formatPercent(report.platformThresholds.jjwxc)}`,
      note: "仅限 3 类辅助",
    },
    {
      key: "fanqie",
      label: `${PLATFORM_LABELS.fanqie} ${formatPercent(report.platformThresholds.fanqie)}`,
      note: "平台审核趋严",
    },
    {
      key: "aigc-draft",
      label: `AIGC 办法（草案） ${formatPercent(report.platformThresholds.generic)}`,
      note: "政策参考上限",
    },
  ] as const;
}

function ChapterRatioBadge({ chapter }: { readonly chapter: ChapterAiEstimate }) {
  if (chapter.isAboveThreshold) {
    return <Badge variant="destructive">建议人工改写</Badge>;
  }
  if (chapter.level === "caution") {
    return <Badge variant="secondary">接近阈值</Badge>;
  }
  return <Badge variant="outline">安全</Badge>;
}

export function AiRatioReport({ report }: AiRatioReportProps) {
  const currentPlatformLabel = PLATFORM_LABELS[report.platform];
  const currentThreshold = formatPercent(report.platformThreshold);
  const overallRatio = formatPercent(report.overallAiRatio);
  const referenceItems = getReferenceItems(report);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>AI 比例估算报告</CardTitle>
            <CardDescription>{report.methodology}</CardDescription>
          </div>
          <Badge variant={LEVEL_BADGE_VARIANTS[report.overallLevel]}>{LEVEL_LABELS[report.overallLevel]}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">总体估算</div>
                <div className="text-2xl font-semibold">总体估算 {overallRatio}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <div>当前平台：{currentPlatformLabel}</div>
                <div>总字数 {report.totalWords.toLocaleString()}</div>
              </div>
            </div>
            <Progress aria-label={`当前平台阈值 ${currentThreshold}`} value={Math.min(report.overallAiRatio * 100, 100)} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>当前平台阈值 {currentThreshold}</span>
              <span>仅供参考</span>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="text-sm font-medium">平台参考阈值</div>
            <div className="space-y-2">
              {referenceItems.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                  <div className="text-sm">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>章节</TableHead>
                <TableHead>字数</TableHead>
                <TableHead>AI 味分数</TableHead>
                <TableHead>估算比例</TableHead>
                <TableHead>进度</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.chapters.map((chapter) => (
                <TableRow key={`${chapter.chapterNumber}-${chapter.chapterTitle}`}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{chapter.chapterTitle}</div>
                      <div className="text-xs text-muted-foreground">第 {chapter.chapterNumber} 章</div>
                    </div>
                  </TableCell>
                  <TableCell>{chapter.wordCount.toLocaleString()}</TableCell>
                  <TableCell>{formatPercent(chapter.aiTasteScore)}</TableCell>
                  <TableCell className="font-medium">{formatPercent(chapter.estimatedAiRatio)}</TableCell>
                  <TableCell className="w-[180px]">
                    <div className="space-y-2">
                      <Progress value={Math.min(chapter.estimatedAiRatio * 100, 100)} />
                      <div className="text-xs text-muted-foreground">阈值 {currentThreshold}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ChapterRatioBadge chapter={chapter} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {chapter.isAboveThreshold ? "高于当前平台阈值" : "未超过当前平台阈值"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
