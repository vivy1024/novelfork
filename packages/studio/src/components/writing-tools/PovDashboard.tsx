import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface PovDashboardData {
  readonly characters: ReadonlyArray<{
    readonly name: string;
    readonly totalChapters: number;
    readonly lastAppearanceChapter: number;
    readonly gapSinceLastAppearance: number;
    readonly chapterNumbers: ReadonlyArray<number>;
  }>;
  readonly currentChapter: number;
  readonly warnings: ReadonlyArray<{
    readonly characterName: string;
    readonly gapChapters: number;
    readonly message: string;
  }>;
  readonly suggestion?: {
    readonly recommendedPov: string;
    readonly reason: string;
  };
}

export interface PovDashboardProps {
  readonly dashboard: PovDashboardData;
}

export function PovDashboard({ dashboard }: PovDashboardProps) {
  if (dashboard.characters.length <= 1) return null;

  const maxChapters = Math.max(1, ...dashboard.characters.map((character) => character.totalChapters));

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>POV 视角仪表盘</CardTitle>
            <CardDescription>当前第 {dashboard.currentChapter} 章 · 追踪多视角章节分配与遗忘风险。</CardDescription>
          </div>
          <Badge variant={dashboard.warnings.length > 0 ? "secondary" : "outline"}>{dashboard.characters.length} 个 POV</Badge>
        </div>
        {dashboard.suggestion ? (
          <Alert>
            <AlertTitle>建议下一章 POV：{dashboard.suggestion.recommendedPov}</AlertTitle>
            <AlertDescription>{dashboard.suggestion.reason}</AlertDescription>
          </Alert>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {dashboard.warnings.length > 0 ? (
          <div className="space-y-2">
            {dashboard.warnings.map((warning) => (
              <Alert key={`${warning.characterName}-${warning.gapChapters}`} className="border-amber-500/30 bg-amber-500/5">
                <AlertTitle>{warning.characterName} POV 间隔预警</AlertTitle>
                <AlertDescription>{warning.message}</AlertDescription>
              </Alert>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>角色</TableHead>
                <TableHead>章节数</TableHead>
                <TableHead>最近出现</TableHead>
                <TableHead>间隔</TableHead>
                <TableHead>分配</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.characters.map((character) => (
                <TableRow key={character.name}>
                  <TableCell className="font-medium">{character.name}</TableCell>
                  <TableCell>{character.totalChapters}</TableCell>
                  <TableCell>第 {character.lastAppearanceChapter} 章</TableCell>
                  <TableCell>
                    <Badge variant={character.gapSinceLastAppearance >= 10 ? "destructive" : "outline"}>
                      {character.gapSinceLastAppearance} 章
                    </Badge>
                  </TableCell>
                  <TableCell className="w-[220px]">
                    <div className="space-y-2">
                      <Progress value={(character.totalChapters / maxChapters) * 100} />
                      <div className="text-xs text-muted-foreground">{character.chapterNumbers.join(" / ")}</div>
                    </div>
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
