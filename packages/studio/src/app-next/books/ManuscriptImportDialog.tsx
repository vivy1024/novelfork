/**
 * 书架「导入旧稿」（T4.2）：选旧稿 → 切分预览与调整 → 确认写章 → 逐章事实 → 导入报告 → 完成导入。
 *
 * 只有正文、没有 book.json 的旧稿走这里；带 book.json 的作品目录仍走「导入已有作品」。
 * 新建书由书架的建书接口完成，之后所有步骤只调本书的 manuscript-import 接口。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ManuscriptImportRequestError,
  type ManuscriptExplanation,
  type ManuscriptImportClient,
  type ManuscriptImportView,
  type ManuscriptPreviewChapter,
} from "../runtime/manuscript-import-client";

export interface ManuscriptImportDialogProps {
  readonly open: boolean;
  /** 继续一个已开始的导入：书与任务都已存在。 */
  readonly resume?: { readonly bookId: string; readonly jobId: string } | null;
  readonly client: ManuscriptImportClient;
  /** 新建一本空书并返回书 ID（复用书架建书）。 */
  readonly createBook: (title: string) => Promise<string>;
  readonly onClose: () => void;
  /** 书架需要刷新（新建了书、导入状态变了）。 */
  readonly onChanged: () => Promise<void> | void;
  readonly onOpenBook: (bookId: string) => void;
}

const SETTLE_LABEL: Record<string, string> = {
  pending: "待处理",
  running: "处理中",
  done: "已完成",
  skipped: "已跳过",
  failed: "失败",
};

function ExplanationAlert({ title, explanation, tone = "info" }: { readonly title: string; readonly explanation: ManuscriptExplanation; readonly tone?: "info" | "error" }) {
  return (
    <Alert className={tone === "error" ? "border-destructive/30" : undefined}>
      <AlertTitle className={tone === "error" ? "text-destructive" : undefined}>{title}</AlertTitle>
      <AlertDescription>
        <p>{explanation.whatHappened}</p>
        <p className="mt-1 text-muted-foreground">{explanation.whyItMatters}</p>
        <p className="mt-1">{explanation.suggestedAction}</p>
      </AlertDescription>
    </Alert>
  );
}

function errorExplanation(caught: unknown): ManuscriptExplanation {
  if (caught instanceof ManuscriptImportRequestError && caught.explanation) return caught.explanation;
  return {
    whatHappened: caught instanceof Error ? caught.message : "操作失败。",
    whyItMatters: "这一步没有完成，已有的进度不受影响。",
    suggestedAction: "稍后重试；若反复失败，刷新页面后再试。",
  };
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/u, "").trim();
}

export function ManuscriptImportDialog({ open, resume, client, createBook, onClose, onChanged, onOpenBook }: ManuscriptImportDialogProps) {
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [pattern, setPattern] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);
  const [view, setView] = useState<ManuscriptImportView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ManuscriptExplanation | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; title: string } | null>(null);
  const [splitting, setSplitting] = useState<{ index: number; lines: readonly string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // 写 view 的请求序号：每发一次会改 view 的请求就领一个新号，响应回来时号已过期就丢掉。
  // 轮询、恢复读取、用户操作三路并发，晚到的旧响应不能把刚操作后的新状态盖回去；
  // 弹窗关闭或切换任务时也领新号，让在途请求一律作废。
  const viewSeq = useRef(0);
  const [pollFailures, setPollFailures] = useState(0);

  useEffect(() => {
    const seq = ++viewSeq.current;
    if (!open) return;
    setError(null);
    setRenaming(null);
    setSplitting(null);
    setPollFailures(0);
    // 上次关闭时可能有被作废的操作没来得及清 busy。
    setBusy(null);
    if (resume) {
      setBookId(resume.bookId);
      // 先清掉上一个任务的内容，新任务加载完成前不显示别的任务。
      setView(null);
      setBusy("load");
      client.read(resume.bookId, resume.jobId)
        .then((loaded) => {
          if (seq !== viewSeq.current) return;
          setView(loaded);
          setPattern(loaded.job.split.pattern ?? "");
        })
        .catch((caught: unknown) => { if (seq === viewSeq.current) setError(errorExplanation(caught)); })
        .finally(() => { if (seq === viewSeq.current) setBusy(null); });
    } else {
      setBookId(null);
      setView(null);
      setFiles([]);
      setTitle("");
      setPattern("");
    }
    return () => { viewSeq.current += 1; };
  }, [open, resume, client]);

  // 逐章事实在后台跑：运行中每 2 秒刷新一次任务；用户操作进行中（busy）时暂停，避免和操作结果互相覆盖。
  const running = Boolean(view?.running || view?.job.settlement.state === "running");
  const pollJobId = view?.job.jobId;
  useEffect(() => {
    if (!open || !running || !bookId || !pollJobId || busy) return;
    // 本轮轮询自己的取消标记：只作废本轮在途的轮询响应，不动全局序号（否则会把刚开始的用户操作一起作废）。
    let cancelled = false;
    const timer = setInterval(() => {
      const seq = ++viewSeq.current;
      client.read(bookId, pollJobId)
        .then((next) => {
          if (cancelled || seq !== viewSeq.current) return;
          setView(next);
          setPollFailures(0);
        })
        .catch(() => { if (!cancelled && seq === viewSeq.current) setPollFailures((count) => count + 1); });
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, running, bookId, pollJobId, busy, client]);

  const run = useCallback(async (label: string, action: () => Promise<ManuscriptImportView | void>) => {
    const seq = ++viewSeq.current;
    setBusy(label);
    setError(null);
    try {
      const next = await action();
      if (next && seq === viewSeq.current) setView(next);
    } catch (caught) {
      if (seq === viewSeq.current) setError(errorExplanation(caught));
    } finally {
      if (seq === viewSeq.current) setBusy(null);
    }
  }, []);

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []).filter((file) => /\.(txt|md|markdown|text)$/iu.test(file.name));
    setFiles(picked);
    if (!title.trim() && picked[0]) {
      const relative = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
      setTitle(relative && picked.length > 1 ? relative.split("/")[0] ?? "" : stripExtension(picked[0].name));
    }
    event.target.value = "";
  };

  const start = () => run("start", async () => {
    const bookTitle = title.trim();
    if (!bookTitle || files.length === 0) return;
    const targetBookId = bookId ?? await createBook(bookTitle);
    setBookId(targetBookId);
    const started = await client.start(targetBookId, {
      sourceName: files.length === 1 ? files[0]!.name : bookTitle,
      files,
      ...(pattern.trim() ? { splitPattern: pattern.trim() } : {}),
    });
    await onChanged();
    return started;
  });

  const jobId = view?.job.jobId;
  const revision = view?.preview?.revision ?? view?.job.planRevision ?? 0;
  const phase = view?.job.phase;

  const edit = (label: string, body: Parameters<ManuscriptImportClient["edit"]>[3]) => {
    if (!bookId || !jobId) return;
    void run(label, () => client.edit(bookId, jobId, revision, body));
  };

  const openSplit = (chapter: ManuscriptPreviewChapter) => {
    if (!bookId || !jobId) return;
    void run("lines", async () => {
      const loaded = await client.readChapterLines(bookId, jobId, chapter.index);
      setSplitting({ index: chapter.index, lines: loaded.lines });
    });
  };

  const close = () => {
    if (busy && busy !== "load") return;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-3xl" data-testid="manuscript-import-dialog">
        <DialogHeader>
          <DialogTitle>导入旧稿</DialogTitle>
          <DialogDescription>
            把只有正文的旧稿（一个 txt/md 文件，或只有章节文件的文件夹）导入成一本可以继续写的书。原文会原样存一份快照在书里，你的原文件不会被改动或移动。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-auto pr-1">
          {error ? <ExplanationAlert title="这一步没有完成" explanation={error} tone="error" /> : null}

          {!view ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manuscript-title">书名</FieldLabel>
                <Input id="manuscript-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：长夜" disabled={Boolean(bookId)} />
              </Field>
              <Field>
                <FieldLabel>旧稿</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>选择文本文件</Button>
                  <Button type="button" variant="outline" onClick={() => folderInput.current?.click()}>选择章节文件夹</Button>
                </div>
                <input ref={fileInput} type="file" accept=".txt,.md,.markdown,.text,text/plain,text/markdown" className="hidden" aria-label="选择旧稿文本文件" onChange={pickFiles} />
                <input
                  ref={(element) => {
                    folderInput.current = element;
                    element?.setAttribute("webkitdirectory", "");
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  aria-label="选择旧稿章节文件夹"
                  onChange={pickFiles}
                />
                <FieldDescription>
                  {files.length === 0
                    ? "支持 UTF-8 与 GBK 编码。文件夹里每个 txt/md 文件算一章，按文件名顺序排列。"
                    : files.length === 1
                      ? `已选：${files[0]!.name}（${(files[0]!.size / 1024).toFixed(1)} KB）`
                      : `已选文件夹里的 ${files.length} 个章节文件`}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="manuscript-pattern">分章规则（可选）</FieldLabel>
                <Input id="manuscript-pattern" value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="留空自动识别：第N章 / 第N回 / Chapter N" />
                <FieldDescription>按章节标题所在行匹配，一般留空即可。</FieldDescription>
              </Field>
            </FieldGroup>
          ) : null}

          {view && phase === "preview" && view.preview ? (
            <section className="flex flex-col gap-3" data-testid="manuscript-preview">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grow">
                  <FieldLabel htmlFor="manuscript-resplit-pattern">分章规则</FieldLabel>
                  <Input id="manuscript-resplit-pattern" value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="留空自动识别：第N章 / 第N回 / Chapter N" />
                </div>
                <Button variant="outline" disabled={busy !== null} onClick={() => bookId && jobId && void run("resplit", () => client.resplit(bookId, jobId, { mode: "rule", ...(pattern.trim() ? { pattern: pattern.trim() } : {}) }))}>
                  按规则重切
                </Button>
                {view.job.source.kind === "files" ? (
                  <Button variant="outline" disabled={busy !== null} onClick={() => bookId && jobId && void run("resplit", () => client.resplit(bookId, jobId, { mode: "by-file" }))}>
                    按文件切
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                共 {view.preview.chapterCount} 章，{view.preview.totalChars} 字（原文 {view.job.source.files.length} 个文件，编码 {[...new Set(view.job.source.files.map((file) => file.encoding))].join("、")}）。确认前不会写入任何章节。
              </p>
              {view.preview.warnings.map((warning) => (
                <Alert key={warning}><AlertDescription>{warning}</AlertDescription></Alert>
              ))}
              <ol className="flex flex-col gap-2">
                {view.preview.chapters.map((chapter, offset) => (
                  <li key={`${chapter.index}-${chapter.title}`} className="rounded-lg border p-3 text-sm" data-testid="manuscript-preview-chapter">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {renaming?.index === chapter.index ? (
                        <form
                          className="flex grow gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            edit("rename", { op: "rename", index: chapter.index, title: renaming.title });
                            setRenaming(null);
                          }}
                        >
                          <Input aria-label={`第 ${chapter.index} 章标题`} value={renaming.title} onChange={(event) => setRenaming({ index: chapter.index, title: event.target.value })} autoFocus />
                          <Button type="submit" size="sm">保存</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>取消</Button>
                        </form>
                      ) : (
                        <span className="font-medium">第 {chapter.index} 章 · {chapter.title}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{chapter.chars} 字{chapter.sourceFile ? ` · ${chapter.sourceFile}` : ""}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">开头：{chapter.head || "（空）"}</p>
                    <p className="text-xs text-muted-foreground">结尾：{chapter.tail || "（空）"}</p>
                    {chapter.anomalies.map((anomaly) => (
                      <p key={anomaly.code} className="mt-1 text-xs text-destructive">{anomaly.message}</p>
                    ))}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setRenaming({ index: chapter.index, title: chapter.title })}>改标题</Button>
                      <Button size="sm" variant="outline" disabled={busy !== null || offset === view.preview!.chapters.length - 1} onClick={() => edit("merge", { op: "merge", index: chapter.index })}>与下一章合并</Button>
                      <Button size="sm" variant="outline" disabled={busy !== null || chapter.lineCount < 2} onClick={() => openSplit(chapter)}>拆分</Button>
                    </div>
                    {splitting?.index === chapter.index ? (
                      <div className="mt-2 rounded-md border bg-muted/30 p-2">
                        <p className="mb-1 text-xs text-muted-foreground">点一行，从这一行起拆成新的一章（短行会当作新章标题）。</p>
                        <ol className="max-h-48 overflow-auto text-xs">
                          {splitting.lines.map((line, lineIndex) => lineIndex === 0 || !line.trim() ? null : (
                            <li key={lineIndex}>
                              <button
                                type="button"
                                className="w-full truncate rounded px-1 text-left hover:bg-accent"
                                onClick={() => {
                                  edit("split", { op: "split", index: chapter.index, atLine: lineIndex });
                                  setSplitting(null);
                                }}
                              >
                                {lineIndex + 1}. {line}
                              </button>
                            </li>
                          ))}
                        </ol>
                        <Button size="sm" variant="ghost" onClick={() => setSplitting(null)}>取消拆分</Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {view && (phase === "writing" || phase === "written" || phase === "published") ? (
            <section className="flex flex-col gap-3" data-testid="manuscript-settlement">
              <p className="text-sm">
                已写入 {view.progress.written}/{view.progress.total} 章；逐章事实 {view.progress.settled} 章完成
                {view.progress.failed > 0 ? `，${view.progress.failed} 章失败` : ""}
                {view.progress.pending > 0 ? `，${view.progress.pending} 章待处理` : ""}。
                {phase === "published" ? <Badge className="ml-2">已完成导入</Badge> : <Badge variant="secondary" className="ml-2">导入中</Badge>}
              </p>
              {view.job.settlement.explanation ? (
                <ExplanationAlert
                  title={view.job.settlement.state === "blocked" ? "逐章事实停在这一步" : "逐章事实已暂停"}
                  explanation={view.job.settlement.explanation}
                />
              ) : null}
              {running ? <p className="text-sm text-muted-foreground">逐章事实进行中，没把握的变化会放进「待确认」。</p> : null}
              {running && pollFailures >= 3 ? (
                <p role="status" className="text-sm text-destructive">
                  连续 {pollFailures} 次没刷新到进度（可能断网或服务重启）。后台仍在跑的话进度不会丢；关掉导入页再从书架重新打开即可看到最新状态。
                </p>
              ) : null}
              <ul className="flex flex-col gap-1 text-sm">
                {view.job.chapters.map((chapter) => (
                  <li key={chapter.index} className="flex flex-wrap items-center justify-between gap-2">
                    <span>第 {chapter.chapterNumber} 章 · {chapter.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {chapter.settle.status === "done" && chapter.settle.extracted !== undefined ? `${chapter.settle.extracted} 条事件，待审 ${chapter.settle.pending ?? 0}` : null}
                      <Badge variant={chapter.settle.status === "failed" ? "destructive" : chapter.settle.status === "done" ? "default" : "secondary"}>
                        {chapter.written ? SETTLE_LABEL[chapter.settle.status] : "未写入"}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
              {view.job.report ? (
                <div className="rounded-lg border p-3 text-sm" data-testid="manuscript-report">
                  <p className="font-medium">导入报告</p>
                  <p className="mt-1">
                    {view.job.report.chapterCount} 章，已有叙事记忆 {view.job.report.settledChapters} 章；事件 {view.job.report.eventCount} 条（待审 {view.job.report.pendingEventCount}，其中高风险 {view.job.report.highRiskPendingCount}）；
                    实体 {view.job.report.entityCount} 个、关系 {view.job.report.relationCount} 条；伏笔 {view.job.report.foreshadow.total} 条；剧情线 {view.job.report.storylines.length} 条；全书待确认 {view.job.report.pendingReviewTotal} 项。
                  </p>
                  {view.job.report.characterDrafts && view.job.report.characterDrafts.pending > 0 ? (
                    <div className="mt-2 flex flex-col gap-2" data-testid="manuscript-character-drafts">
                      <ExplanationAlert
                        title={`待你确认的人物草稿 ${view.job.report.characterDrafts.pending} 个，确认后才会生效`}
                        explanation={view.job.report.characterDrafts.explanation}
                      />
                      <p className="text-xs text-muted-foreground">
                        {view.job.report.characterDrafts.items.slice(0, 12).map((item) => item.occurrences !== undefined ? `${item.title}（${item.occurrences} 次）` : item.title).join("、")}
                        {view.job.report.characterDrafts.pending > 12 ? ` 等 ${view.job.report.characterDrafts.pending} 个` : ""}
                      </p>
                      {phase === "published" && bookId ? (
                        <div>
                          <Button size="sm" variant="outline" onClick={() => { onClose(); onOpenBook(bookId); }}>
                            去待确认处理
                          </Button>
                          <p className="mt-1 text-xs text-muted-foreground">打开工作台后，在「技能文风」顶部的「待确认」里逐个处理人物。</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">完成导入后，在工作台「技能文风」顶部的「待确认」里处理。</p>
                      )}
                    </div>
                  ) : null}
                  {view.job.report.failedChapters.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {view.job.report.failedChapters.map((failure) => (
                        <li key={failure.chapterNumber} className="whitespace-pre-line text-xs text-destructive">第 {failure.chapterNumber} 章 · {failure.title}：{failure.reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  {view.job.report.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-muted-foreground">{warning}</p>)}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" disabled={busy !== null && busy !== "load"} onClick={close}>
            {view ? "稍后继续" : "取消"}
          </Button>
          {!view ? (
            <Button disabled={busy !== null || !title.trim() || files.length === 0} onClick={() => void start()}>
              {busy === "start" ? "读取中…" : "切分预览"}
            </Button>
          ) : null}
          {view && (phase === "preview" || phase === "writing") ? (
            <Button disabled={busy !== null || (phase === "preview" && (view.preview?.chapterCount ?? 0) === 0)} onClick={() => bookId && jobId && void run("confirm", async () => {
              const next = await client.confirm(bookId, jobId, revision);
              await onChanged();
              return next;
            })}>
              {busy === "confirm" ? "写入中…" : phase === "writing" ? "继续写入章节" : `确认并写入 ${view.preview?.chapterCount ?? 0} 章`}
            </Button>
          ) : null}
          {view && (phase === "written" || phase === "published") && !running && (view.progress.pending > 0 || view.progress.failed > 0) ? (
            <Button variant="outline" disabled={busy !== null} onClick={() => bookId && jobId && void run("settle", () => client.settle(bookId, jobId, view.progress.pending === 0))}>
              {view.progress.pending === 0 ? "重跑失败的章" : "继续逐章事实"}
            </Button>
          ) : null}
          {view && phase === "written" && !running && !view.job.report ? (
            <Button variant="outline" disabled={busy !== null} onClick={() => bookId && jobId && void run("synthesize", () => client.synthesize(bookId, jobId))}>
              生成导入报告
            </Button>
          ) : null}
          {view && phase === "written" ? (
            <Button disabled={busy !== null || running} onClick={() => bookId && jobId && void run("publish", async () => {
              const next = await client.publish(bookId, jobId);
              await onChanged();
              return next;
            })}>
              {busy === "publish" ? "完成中…" : "完成导入"}
            </Button>
          ) : null}
          {view && phase === "published" && bookId ? (
            <Button onClick={() => { onClose(); onOpenBook(bookId); }}>打开工作台</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
