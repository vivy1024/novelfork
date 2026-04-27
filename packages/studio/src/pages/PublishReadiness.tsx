import { useMemo, useState } from "react";

import type { AiDisclosure, PublishReadinessReport, SupportedPlatform } from "@vivy1024/novelfork-core/compliance";

import { AiDisclosureEditor } from "@/components/compliance/AiDisclosureEditor";
import { AiRatioReport } from "@/components/compliance/AiRatioReport";
import { SensitiveWordReport } from "@/components/compliance/SensitiveWordReport";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/hooks/use-api";
import { notify } from "@/lib/notify";

const PLATFORM_OPTIONS: ReadonlyArray<{ value: SupportedPlatform; label: string }> = [
  { value: "qidian", label: "起点中文网" },
  { value: "jjwxc", label: "晋江文学城" },
  { value: "fanqie", label: "番茄小说" },
  { value: "qimao", label: "七猫小说" },
  { value: "generic", label: "通用参考" },
];

const STATUS_LABELS: Record<PublishReadinessReport["status"], string> = {
  ready: "就绪",
  "has-warnings": "存在警告",
  blocked: "建议修复后再投稿",
};

const STATUS_BADGE_VARIANTS: Record<PublishReadinessReport["status"], "default" | "secondary" | "outline" | "destructive"> = {
  ready: "outline",
  "has-warnings": "secondary",
  blocked: "destructive",
};

interface PublishReadinessProps {
  readonly bookId: string;
}

export function PublishReadiness({ bookId }: PublishReadinessProps) {
  const [platform, setPlatform] = useState<SupportedPlatform>("qidian");
  const [report, setReport] = useState<PublishReadinessReport | null>(null);
  const [disclosure, setDisclosure] = useState<AiDisclosure | null>(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [editedDisclosureText, setEditedDisclosureText] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [generatingDisclosure, setGeneratingDisclosure] = useState(false);
  const [openSection, setOpenSection] = useState<string | undefined>(undefined);

  const summary = useMemo(() => {
    if (!report) return null;
    return {
      block: report.totalBlockCount,
      warn: report.totalWarnCount,
      suggest: report.totalSuggestCount,
    };
  }, [report]);

  async function runReadinessCheck() {
    setChecking(true);
    try {
      const response = await fetchJson<{ report: PublishReadinessReport }>(`/books/${bookId}/compliance/publish-readiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      setReport(response.report);
      setOpenSection(undefined);
      notify.success("发布就绪检查完成");
    } catch (error) {
      notify.error("发布就绪检查失败", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setChecking(false);
    }
  }

  async function generateDisclosure() {
    setGeneratingDisclosure(true);
    try {
      const response = await fetchJson<{ disclosure: AiDisclosure }>(`/books/${bookId}/compliance/ai-disclosure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      setDisclosure(response.disclosure);
      setEditedDisclosureText(response.disclosure.markdownText);
      setDisclosureOpen(true);
      notify.success("AI 标注已生成");
    } catch (error) {
      notify.error("生成 AI 标注失败", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setGeneratingDisclosure(false);
    }
  }

  function exportReport() {
    if (!report) return;

    const payload = {
      generatedAt: new Date().toISOString(),
      platform,
      report,
      disclosure,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `publish-readiness-${bookId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify.success("报告已导出");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>发布就绪检查</CardTitle>
          <CardDescription>一键执行敏感词扫描、AI 比例估算和格式规范检查。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="publish-readiness-platform">目标平台</Label>
              <Select value={platform} onValueChange={(value) => setPlatform(value as SupportedPlatform)}>
                <SelectTrigger id="publish-readiness-platform" aria-label="目标平台" className="w-full">
                  <SelectValue placeholder="选择目标平台" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void runReadinessCheck()} disabled={checking}>
                {checking ? "检查中..." : "开始检查"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void generateDisclosure()} disabled={generatingDisclosure || !report}>
                {generatingDisclosure ? "生成中..." : "生成 AI 标注"}
              </Button>
              <Button type="button" variant="outline" onClick={exportReport} disabled={!report}>
                导出报告
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {report ? (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <CardTitle>{STATUS_LABELS[report.status]}</CardTitle>
                <CardDescription>目标平台：{PLATFORM_OPTIONS.find((item) => item.value === report.platform)?.label ?? report.platform}</CardDescription>
              </div>
              <Badge variant={STATUS_BADGE_VARIANTS[report.status]}>{STATUS_LABELS[report.status]}</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="destructive">block {summary?.block ?? 0}</Badge>
                <Badge variant="secondary">warn {summary?.warn ?? 0}</Badge>
                <Badge variant="outline">suggest {summary?.suggest ?? 0}</Badge>
              </div>
            </CardContent>
          </Card>

          <Accordion value={openSection} onValueChange={setOpenSection} collapsible>
            <AccordionItem value="sensitive">
              <AccordionTrigger>敏感词扫描</AccordionTrigger>
              <AccordionContent>
                <SensitiveWordReport report={report.sensitiveScan} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="ai-ratio">
              <AccordionTrigger>AI 比例估算</AccordionTrigger>
              <AccordionContent>
                <AiRatioReport report={report.aiRatio} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="format-check">
              <AccordionTrigger>格式规范检查</AccordionTrigger>
              <AccordionContent>
                <Card>
                  <CardHeader>
                    <CardTitle>格式规范检查</CardTitle>
                    <CardDescription>
                      共 {report.formatCheck.issues.length} 项，平均单章 {Math.round(report.formatCheck.avgChapterWords).toLocaleString()} 字。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {report.formatCheck.issues.length > 0 ? (
                      report.formatCheck.issues.map((issue, index) => (
                        <div key={`${issue.type}-${issue.chapterNumber ?? "global"}-${index}`} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={issue.severity === "block" ? "destructive" : issue.severity === "warn" ? "secondary" : "outline"}>
                              {issue.severity}
                            </Badge>
                            {issue.chapterNumber ? <span className="text-sm text-muted-foreground">第 {issue.chapterNumber} 章</span> : null}
                          </div>
                          <div className="mt-2 font-medium">{issue.message}</div>
                          {issue.detail ? <div className="mt-1 text-sm text-muted-foreground">{issue.detail}</div> : null}
                          {issue.suggestion ? <div className="mt-1 text-sm text-muted-foreground">建议：{issue.suggestion}</div> : null}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">未发现格式问题。</div>
                    )}
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      ) : null}

      <Dialog open={disclosureOpen} onOpenChange={setDisclosureOpen}>
        <DialogContent className="max-w-2xl" showCloseButton>
          <DialogHeader>
            <DialogTitle render={<h2 />}>AI 使用标注</DialogTitle>
            <DialogDescription>可作为投稿前的 AI 使用说明预览。</DialogDescription>
          </DialogHeader>
          {disclosure ? (
            <AiDisclosureEditor
              disclosure={{
                ...disclosure,
                markdownText: editedDisclosureText ?? disclosure.markdownText,
              }}
              onChange={setEditedDisclosureText}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={exportReport} disabled={!report}>
              导出报告
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
