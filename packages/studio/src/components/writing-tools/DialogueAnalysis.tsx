import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DialogueAnalysisResult {
  readonly totalWords: number;
  readonly dialogueWords: number;
  readonly dialogueRatio: number;
  readonly chapterType?: string;
  readonly referenceRange: {
    readonly min: number;
    readonly max: number;
  };
  readonly isHealthy: boolean;
  readonly characterDialogue: ReadonlyArray<{
    readonly name: string;
    readonly wordCount: number;
    readonly lineCount: number;
    readonly ratio: number;
  }>;
  readonly issues: ReadonlyArray<string>;
}

export interface DialogueAnalysisProps {
  readonly analysis: DialogueAnalysisResult;
}

const CHAPTER_TYPE_LABELS: Record<string, string> = {
  battle: "战斗章",
  daily: "日常/社交章",
  transition: "过渡章",
  mystery: "悬疑/推理章",
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function DialogueAnalysis({ analysis }: DialogueAnalysisProps) {
  const chapterTypeLabel = analysis.chapterType ? CHAPTER_TYPE_LABELS[analysis.chapterType] ?? analysis.chapterType : "未标注章节类型";

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>对话比例分析</CardTitle>
            <CardDescription>{chapterTypeLabel} · 总字数 {analysis.totalWords.toLocaleString()} · 对话 {analysis.dialogueWords.toLocaleString()}</CardDescription>
          </div>
          <Badge variant={analysis.isHealthy ? "outline" : "destructive"}>{analysis.isHealthy ? "健康" : "需关注"}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">对话占比</div>
                <div className="text-3xl font-semibold">{formatPercent(analysis.dialogueRatio)}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <div>参考范围 {formatPercent(analysis.referenceRange.min)} - {formatPercent(analysis.referenceRange.max)}</div>
                <div>{chapterTypeLabel}</div>
              </div>
            </div>
            <Progress aria-label="对话占比" value={Math.min(analysis.dialogueRatio * 100, 100)} />
          </div>

          <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="text-sm font-medium">参考范围说明</div>
            <div className="text-sm text-muted-foreground">战斗章 10-25% · 日常章 30-50% · 过渡章 15-35% · 悬疑章 25-40%</div>
            <div className="text-sm text-muted-foreground">当前范围 {formatPercent(analysis.referenceRange.min)} - {formatPercent(analysis.referenceRange.max)}</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {analysis.issues.length > 0 ? (
          <Alert className="border-destructive/20 bg-destructive/5">
            <AlertTitle>对话比例偏离参考范围</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 space-y-1">
                {analysis.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>角色</TableHead>
                <TableHead>对话字数</TableHead>
                <TableHead>行数</TableHead>
                <TableHead>占比</TableHead>
                <TableHead>分布</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.characterDialogue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">暂无可归属角色的对话。</TableCell>
                </TableRow>
              ) : analysis.characterDialogue.map((character) => (
                <TableRow key={character.name}>
                  <TableCell className="font-medium">{character.name}</TableCell>
                  <TableCell>{character.wordCount.toLocaleString()}</TableCell>
                  <TableCell>{character.lineCount}</TableCell>
                  <TableCell>{formatPercent(character.ratio)}</TableCell>
                  <TableCell className="w-[180px]"><Progress value={Math.min(character.ratio * 100, 100)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
