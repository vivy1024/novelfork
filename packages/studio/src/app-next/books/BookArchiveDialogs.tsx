import { useEffect, useRef, useState } from "react";

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
import type {
  RuntimeBookArchiveImportReport,
  RuntimeBookArchiveImportResult,
  RuntimeBookArchiveModule,
  RuntimeBookArchiveReportItem,
} from "../runtime/product-contract";

type LoadModules = () => Promise<readonly RuntimeBookArchiveModule[]>;

/** 打开对话框时读取服务端的模块清单，默认全选。 */
function useArchiveModules(open: boolean, loadModules: LoadModules) {
  const [modules, setModules] = useState<readonly RuntimeBookArchiveModule[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // 只在打开时读取一次；调用方每次渲染传入新的函数引用也不会重置勾选。
  const loaderRef = useRef(loadModules);
  loaderRef.current = loadModules;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    loaderRef.current()
      .then((loaded) => {
        if (cancelled) return;
        setModules(loaded);
        setSelected(new Set(loaded.map((module) => module.id)));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "读取档案模块失败");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return { modules, selected, error, toggle };
}

function ModulePicker({
  idPrefix,
  modules,
  selected,
  error,
  onToggle,
}: {
  readonly idPrefix: string;
  readonly modules: readonly RuntimeBookArchiveModule[] | null;
  readonly selected: ReadonlySet<string>;
  readonly error: string | null;
  readonly onToggle: (id: string, checked: boolean) => void;
}) {
  if (error) {
    return (
      <Alert className="border-destructive/30">
        <AlertTitle className="text-destructive">读取档案模块失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!modules) return <p className="text-sm text-muted-foreground">正在读取档案模块…</p>;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">包含的模块</legend>
      {modules.map((module) => (
        <label key={module.id} htmlFor={`${idPrefix}-${module.id}`} className="flex items-start gap-2 text-sm">
          <input
            id={`${idPrefix}-${module.id}`}
            type="checkbox"
            className="mt-1"
            checked={selected.has(module.id)}
            onChange={(event) => onToggle(module.id, event.target.checked)}
          />
          <span>
            <span className="font-medium">{module.label}</span>
            <span className="block text-xs text-muted-foreground">{module.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export interface BookArchiveExportDialogProps {
  readonly book: { readonly id: string; readonly title: string } | null;
  readonly loadModules: LoadModules;
  readonly onExport: (bookId: string, modules: readonly string[]) => Promise<void>;
  readonly onClose: () => void;
  readonly onExported: (message: string) => void;
}

export function BookArchiveExportDialog({ book, loadModules, onExport, onClose, onExported }: BookArchiveExportDialogProps) {
  const open = book !== null;
  const { modules, selected, error, toggle } = useArchiveModules(open, loadModules);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setExportError(null);
  }, [open]);

  const submit = async () => {
    if (!book || selected.size === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExport(book.id, [...selected]);
      onExported(`《${book.title}》的项目档案已生成，浏览器会开始下载。`);
      onClose();
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "导出档案失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !exporting) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导出项目档案</DialogTitle>
          <DialogDescription>
            把
            <strong className="mx-1 text-foreground">{book?.title}</strong>
            打包成一个 .zip 档案，在另一台机器的「我的作品」里导入后即可继续写。叙述者会话属于 Runtime，不在档案内。
          </DialogDescription>
        </DialogHeader>
        <ModulePicker idPrefix="export-module" modules={modules} selected={selected} error={error} onToggle={toggle} />
        {exportError ? (
          <Alert className="border-destructive/30">
            <AlertTitle className="text-destructive">导出失败</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={exporting} onClick={onClose}>取消</Button>
          <Button disabled={exporting || !modules || selected.size === 0} onClick={() => void submit()}>
            {exporting ? "导出中…" : "导出档案"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SEVERITY_LABEL: Record<RuntimeBookArchiveReportItem["severity"], string> = {
  missing: "未包含",
  unrecoverable: "无法恢复",
  warning: "请留意",
  info: "说明",
};

const MODULE_STATUS_LABEL: Record<RuntimeBookArchiveImportReport["modules"][number]["status"], string> = {
  imported: "已导入",
  "not-in-archive": "档案中没有",
  "not-selected": "未选择",
};

function ImportReportView({ report }: { readonly report: RuntimeBookArchiveImportReport }) {
  const severities: RuntimeBookArchiveReportItem["severity"][] = ["unrecoverable", "missing", "warning", "info"];
  return (
    <div className="flex max-h-[55vh] flex-col gap-4 overflow-auto" data-testid="book-archive-import-report">
      <p className="text-sm">
        已导入为新书
        <strong className="mx-1">《{report.title}》</strong>
        （{report.bookId}）。档案导出于 {report.exportedAt.slice(0, 19).replace("T", " ")}，来源 NovelFork {report.sourceNovelforkVersion}；
        共重映射 {report.idRemap.remapped} 个记录 ID
        {report.idRemap.renamedOnCollision > 0 ? `，其中 ${report.idRemap.renamedOnCollision} 个因与本机已有记录重名而改名` : ""}。
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {report.modules.map((module) => (
          <li key={module.id} className="flex items-center justify-between gap-2">
            <span>{module.label}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {module.status === "imported" ? `${module.files} 个文件 · ${module.rows} 条记录` : null}
              <Badge variant={module.status === "imported" ? "default" : "secondary"}>{MODULE_STATUS_LABEL[module.status]}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {severities.map((severity) => {
        const items = report.items.filter((item) => item.severity === severity);
        if (items.length === 0) return null;
        return (
          <section key={severity} className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{SEVERITY_LABEL[severity]}（{items.length}）</h3>
            <ul className="flex flex-col gap-1 text-xs">
              {items.map((item, index) => (
                <li key={`${item.target}-${index}`} className="rounded-md border px-2 py-1">
                  <span className="font-medium">{item.target}</span>
                  <span className="block text-muted-foreground">{item.explanation}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export interface BookArchiveImportDialogProps {
  readonly open: boolean;
  readonly loadModules: LoadModules;
  readonly onImport: (archive: File, modules: readonly string[]) => Promise<RuntimeBookArchiveImportResult>;
  readonly onClose: () => void;
  readonly onOpenBook: (bookId: string) => void;
}

export function BookArchiveImportDialog({ open, loadModules, onImport, onClose, onOpenBook }: BookArchiveImportDialogProps) {
  const { modules, selected, error, toggle } = useArchiveModules(open, loadModules);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<RuntimeBookArchiveImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setImportError(null);
    setResult(null);
  }, [open]);

  const submit = async () => {
    if (!file || selected.size === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      setResult(await onImport(file, [...selected]));
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "导入档案失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !importing) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{result ? "导入报告" : "导入项目档案"}</DialogTitle>
          <DialogDescription>
            {result
              ? "档案里缺失或无法恢复的内容逐条列在下面。"
              : "选择在「我的作品」里导出的 .zip 档案。只能导入为新书，不会覆盖已有作品；档案会先整体校验，失败不会留下半本书。"}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          result.report ? (
            <ImportReportView report={result.report} />
          ) : (
            <p className="text-sm">这份档案刚才已经提交过，这里返回的是先前导入的作品（{result.operation.bookId}）。</p>
          )
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="book-archive-file">档案文件</FieldLabel>
              <Input
                id="book-archive-file"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <FieldDescription>档案里的书级技能会进入叙述者提示词，请只导入可信来源的档案。</FieldDescription>
            </Field>
            <ModulePicker idPrefix="import-module" modules={modules} selected={selected} error={error} onToggle={toggle} />
          </FieldGroup>
        )}
        {importError ? (
          <Alert className="border-destructive/30">
            <AlertTitle className="text-destructive">导入失败</AlertTitle>
            <AlertDescription>{importError}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={onClose}>关闭</Button>
              <Button onClick={() => { onOpenBook(result.operation.bookId); onClose(); }}>打开工作台</Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={importing} onClick={onClose}>取消</Button>
              <Button disabled={importing || !file || !modules || selected.size === 0} onClick={() => void submit()}>
                {importing ? "导入中…" : "导入为新书"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
