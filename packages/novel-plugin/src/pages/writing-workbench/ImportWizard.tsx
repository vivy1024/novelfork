import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertCircle, ChevronLeft, ChevronRight, FileUp, Loader2, Sparkles } from "lucide-react";
import { normalizeImportSource, splitChapters, type SplitChapter } from "@vivy1024/novelfork-core";

import {
  DEFAULT_IMPORT_OPTIONS,
  INITIAL_IMPORT_WIZARD_STATE,
  buildImportToolInput,
  canLeaveInputStep,
  canStartImport,
  computeImportStats,
  progressForPhase,
  suggestNextActions,
  summarizePreflight,
  validateSplitPattern,
  type ImportPhase,
  type ImportWizardState,
  type NextActionSuggestion,
} from "./import-wizard-state";

export interface ImportWizardResult {
  readonly importedChapters: number;
  readonly totalWords: number;
  readonly firstChapter: number;
  readonly lastChapter: number;
  readonly preflight?: unknown;
  readonly dissectDraft?: unknown;
}

export interface ImportWizardProps {
  readonly bookId: string;
  /** Runtime tool invoker injected by the workbench route (bookId is host-owned). */
  readonly invokeTool: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
  readonly onClose: () => void;
  readonly onComplete?: (result: ImportWizardResult) => void;
  readonly onNextAction?: (action: NextActionSuggestion["id"]) => void;
}

const PHASE_LABELS: Record<ImportPhase, string> = {
  importing: "导入章节",
  settling: "结算叙事记忆",
  dissecting: "抽取续写草案",
  done: "完成",
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function ImportWizard({ bookId, invokeTool, onClose, onComplete, onNextAction }: ImportWizardProps) {
  const [state, setState] = useState<ImportWizardState>(INITIAL_IMPORT_WIZARD_STATE);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ImportWizardResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => computeImportStats(state.previewChapters), [state.previewChapters]);
  const patternCheck = useMemo(() => validateSplitPattern(state.options.splitPattern), [state.options.splitPattern]);
  const inputCheck = canLeaveInputStep(state);
  const startCheck = canStartImport(state);

  const recomputePreview = useCallback((plainText: string, pattern: string): readonly SplitChapter[] => {
    if (!plainText.trim()) return [];
    try {
      return splitChapters(plainText, pattern.trim() || undefined);
    } catch {
      return [];
    }
  }, []);

  const applyPlainText = useCallback((input: {
    plainText: string;
    rawText: string;
    fileName?: string;
    format?: ImportWizardState["format"];
    formatEvidence?: string;
    metadata?: ImportWizardState["metadata"];
    warnings?: readonly string[];
  }) => {
    setState((prev) => {
      const options = {
        ...prev.options,
        sourceName: prev.options.sourceName === DEFAULT_IMPORT_OPTIONS.sourceName && input.metadata?.title
          ? input.metadata.title
          : prev.options.sourceName,
      };
      return {
        ...prev,
        rawText: input.rawText,
        plainText: input.plainText,
        fileName: input.fileName ?? prev.fileName,
        format: input.format ?? prev.format,
        formatEvidence: input.formatEvidence ?? prev.formatEvidence,
        metadata: input.metadata ?? prev.metadata,
        warnings: input.warnings ?? [],
        options,
        previewChapters: recomputePreview(input.plainText, options.splitPattern),
        error: null,
      };
    });
  }, [recomputePreview]);

  const handlePaste = useCallback(async (text: string) => {
    if (!text.trim()) {
      setState((prev) => ({ ...prev, rawText: text, plainText: "", previewChapters: [], format: null }));
      return;
    }
    setAnalyzing(true);
    try {
      const normalized = await normalizeImportSource({ text });
      applyPlainText({
        rawText: text,
        plainText: normalized.plainText,
        format: normalized.format,
        formatEvidence: normalized.evidence,
        metadata: normalized.metadata,
        warnings: normalized.warnings,
      });
    } finally {
      setAnalyzing(false);
    }
  }, [applyPlainText]);

  const handleFile = useCallback(async (file: File) => {
    setAnalyzing(true);
    try {
      const bytes = await file.arrayBuffer();
      const normalized = await normalizeImportSource({ bytes, fileName: file.name });
      applyPlainText({
        rawText: "",
        plainText: normalized.plainText,
        fileName: file.name,
        format: normalized.format,
        formatEvidence: normalized.evidence,
        metadata: normalized.metadata,
        warnings: normalized.warnings,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: `文件解析失败：${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setAnalyzing(false);
    }
  }, [applyPlainText]);

  const updateOptions = useCallback((patch: Partial<ImportWizardState["options"]>) => {
    setState((prev) => {
      const options = { ...prev.options, ...patch };
      return {
        ...prev,
        options,
        previewChapters: patch.splitPattern !== undefined
          ? recomputePreview(prev.plainText, options.splitPattern)
          : prev.previewChapters,
      };
    });
  }, [recomputePreview]);

  const runImport = useCallback(async () => {
    setState((prev) => ({ ...prev, step: "executing", error: null, progress: { phase: "importing", percent: progressForPhase("importing") } }));
    try {
      const importResponse = await invokeTool("pipeline.import_chapters", buildImportToolInput(state));
      const payload = toRecord(toRecord(importResponse).data ?? importResponse);
      if (toRecord(importResponse).ok === false) {
        throw new Error(String(toRecord(importResponse).summary ?? "导入失败"));
      }

      if (state.options.autoSettle) {
        setState((prev) => ({ ...prev, progress: { phase: "settling", percent: progressForPhase("settling") } }));
      }
      if (state.options.extractBrief) {
        setState((prev) => ({ ...prev, progress: { phase: "dissecting", percent: progressForPhase("dissecting") } }));
      }

      const wizardResult: ImportWizardResult = {
        importedChapters: Number(payload.importedChapters ?? 0),
        totalWords: Number(payload.totalWords ?? 0),
        firstChapter: Number(payload.firstChapter ?? 0),
        lastChapter: Number(payload.lastChapter ?? 0),
        preflight: payload.preflight,
        dissectDraft: payload.dissectDraft,
      };
      setResult(wizardResult);
      setState((prev) => ({ ...prev, progress: { phase: "done", percent: 100 } }));
      onComplete?.(wizardResult);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: `导入失败：${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  }, [invokeTool, onComplete, state]);

  const preflightSummary = useMemo(() => summarizePreflight(result?.preflight), [result]);
  const nextActions = useMemo(() => suggestNextActions({
    preflight: preflightSummary,
    appliedDissectDraft: state.options.applyDissectDraft,
  }), [preflightSummary, state.options.applyDissectDraft]);

  return (
    <div className="flex h-full flex-col gap-4" data-slot="import-wizard" data-book-id={bookId}>
      <header className="flex items-center gap-3">
        <FileUp className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">导入已有作品</h2>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {(["input", "preview", "executing"] as const).map((step, index) => (
            <span
              key={step}
              className={state.step === step ? "text-foreground" : undefined}
              data-active={state.step === step ? "true" : undefined}
            >
              {index + 1}. {step === "input" ? "选择来源" : step === "preview" ? "预览分章" : "执行"}
            </span>
          ))}
        </div>
      </header>

      {state.error ? (
        <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5" aria-hidden />
          {state.error}
        </p>
      ) : null}

      {state.step === "input" ? (
        <section className="flex flex-1 flex-col gap-3" aria-label="选择导入来源">
          <Tabs
            value={state.sourceType}
            onValueChange={(value) => setState((prev) => ({ ...prev, sourceType: value === "file" ? "file" : "paste" }))}
          >
            <TabsList>
              <TabsTrigger value="paste">粘贴文本</TabsTrigger>
              <TabsTrigger value="file">选择文件</TabsTrigger>
            </TabsList>
            <TabsContent value="paste">
              <Textarea
                value={state.rawText}
                onChange={(event) => void handlePaste(event.target.value)}
                placeholder="粘贴 TXT / Markdown / HTML 正文…"
                rows={12}
                aria-label="粘贴正文"
              />
            </TabsContent>
            <TabsContent value="file">
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.html,.htm,.epub"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  选择 TXT / MD / HTML / EPUB 文件
                </Button>
                {state.fileName ? <p className="text-xs text-muted-foreground">已选择：{state.fileName}</p> : null}
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {analyzing ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden /> 正在解析…
              </span>
            ) : null}
            {state.format ? <Badge variant="secondary">{state.format.toUpperCase()}</Badge> : null}
            {state.formatEvidence ? <span className="text-muted-foreground">{state.formatEvidence}</span> : null}
            {state.plainText ? <span>正文 {state.plainText.length} 字</span> : null}
            {state.previewChapters.length > 0 ? <span>预估 {state.previewChapters.length} 章</span> : null}
            {state.metadata.title ? <span>书名：{state.metadata.title}</span> : null}
          </div>

          {state.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">{warning}</p>
          ))}

          <footer className="mt-auto flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button
              disabled={!inputCheck.ok || analyzing}
              onClick={() => setState((prev) => ({ ...prev, step: "preview" }))}
            >
              下一步 <ChevronRight className="size-3.5" aria-hidden />
            </Button>
          </footer>
          {!inputCheck.ok && inputCheck.reason ? (
            <p className="text-right text-xs text-muted-foreground">{inputCheck.reason}</p>
          ) : null}
        </section>
      ) : null}

      {state.step === "preview" ? (
        <section className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_320px]" aria-label="预览分章">
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <ul className="divide-y text-xs">
              {state.previewChapters.map((chapter, index) => (
                <li key={`${index}-${chapter.title}`} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-10 text-muted-foreground">#{index + 1}</span>
                  <span className="flex-1 truncate">{chapter.title || `第${index + 1}章`}</span>
                  <span className="text-muted-foreground">{chapter.content.length} 字</span>
                </li>
              ))}
              {state.previewChapters.length === 0 ? (
                <li className="px-3 py-6 text-center text-muted-foreground">未识别出章节，请调整分章规则。</li>
              ) : null}
            </ul>
          </div>

          <div className="flex flex-col gap-3 text-xs">
            <label className="flex flex-col gap-1">
              来源名称
              <Input
                value={state.options.sourceName}
                onChange={(event) => updateOptions({ sourceName: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              分章正则（留空用默认）
              <Input
                value={state.options.splitPattern}
                onChange={(event) => updateOptions({ splitPattern: event.target.value })}
                placeholder="^第\\d+章"
              />
            </label>
            {!patternCheck.ok && patternCheck.reason ? (
              <p className="text-destructive">{patternCheck.reason}</p>
            ) : null}

            <div className="flex items-center justify-between">
              <span>导入后自动结算记忆</span>
              <Switch
                checked={state.options.autoSettle}
                onCheckedChange={(checked) => updateOptions({ autoSettle: checked })}
                aria-label="导入后自动结算记忆"
              />
            </div>
            <div className="flex items-center justify-between">
              <span>抽取续写草案</span>
              <Switch
                checked={state.options.extractBrief}
                onCheckedChange={(checked) => updateOptions({ extractBrief: checked })}
                aria-label="抽取续写草案"
              />
            </div>
            <div className="flex items-center justify-between">
              <span>写入草案文件</span>
              <Switch
                checked={state.options.applyDissectDraft}
                onCheckedChange={(checked) => updateOptions({ applyDissectDraft: checked })}
                aria-label="写入草案文件"
              />
            </div>
            <dl className="grid grid-cols-3 gap-2 rounded-md border p-2">
              <div><dt className="text-muted-foreground">章数</dt><dd>{stats.chapterCount}</dd></div>
              <div><dt className="text-muted-foreground">总字数</dt><dd>{stats.totalWords}</dd></div>
              <div><dt className="text-muted-foreground">均章</dt><dd>{stats.averageWords}</dd></div>
            </dl>

            <footer className="mt-auto flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setState((prev) => ({ ...prev, step: "input" }))}>
                <ChevronLeft className="size-3.5" aria-hidden /> 上一步
              </Button>
              <Button disabled={!startCheck.ok || !patternCheck.ok} onClick={() => void runImport()}>
                开始导入
              </Button>
            </footer>
            {!startCheck.ok && startCheck.reason ? (
              <p className="text-muted-foreground">{startCheck.reason}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {state.step === "executing" ? (
        <section className="flex flex-1 flex-col gap-3" aria-label="导入进度">
          <Progress value={state.progress.percent} aria-label="导入进度" />
          <p className="text-xs text-muted-foreground">{PHASE_LABELS[state.progress.phase]}…</p>

          {result ? (
            <div className="flex flex-col gap-3 rounded-md border p-3 text-xs">
              <p>
                导入 {result.importedChapters} 章，共 {result.totalWords} 字
                （第 {result.firstChapter}-{result.lastChapter} 章）
              </p>
              <p className="flex items-center gap-2">
                写前就绪：
                <Badge
                  variant={preflightSummary.light === "green" ? "default" : preflightSummary.light === "yellow" ? "secondary" : "destructive"}
                >
                  {preflightSummary.light === "green" ? "可开写" : preflightSummary.light === "yellow" ? "有提醒" : "未就绪"}
                </Badge>
                {preflightSummary.blockerCodes.length > 0 ? (
                  <span className="text-muted-foreground">{preflightSummary.blockerCodes.join(", ")}</span>
                ) : null}
              </p>
              <div className="flex flex-wrap gap-2">
                {nextActions.map((action) => (
                  <Button
                    key={`${action.id}-${action.label}`}
                    variant={action.primary ? "default" : "outline"}
                    onClick={() => {
                      if (action.id === "close") onClose();
                      else onNextAction?.(action.id);
                    }}
                  >
                    {action.primary ? <Sparkles className="size-3.5" aria-hidden /> : null}
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden /> 正在执行，请勿关闭…
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
