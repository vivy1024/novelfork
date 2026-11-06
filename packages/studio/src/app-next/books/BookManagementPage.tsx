import { useState } from "react";
import {
  BookOpen,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  FolderPen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DirectoryPickerDialog } from "../components/DirectoryPickerDialog";
import { WorkspaceCreateWizard, type WorkspaceCreateInput } from "../components/WorkspaceCreateWizard";
import { BookArchiveExportDialog, BookArchiveImportDialog } from "./BookArchiveDialogs";
import { ManuscriptImportDialog } from "./ManuscriptImportDialog";
import type { ManuscriptImportClient } from "../runtime/manuscript-import-client";
import type {
  RuntimeBookArchiveImportResult,
  RuntimeBookArchiveModule,
  RuntimeBookProvisionOperation,
  RuntimeBookSummary,
  RuntimeRebindBookWorkspaceResult,
} from "../runtime/product-contract";

type ManagedBook = Pick<RuntimeBookSummary, "id" | "title" | "status" | "manuscriptImportJobId">;

/**
 * 书架上给作者看的状态：可写（ready）是常态，不挂徽标；建书流程中途的各阶段统一叫「准备中」，
 * 失败与待补偿各自说明。不改状态值本身，未知值也不把英文原样露给作者。
 */
const BOOK_SHELF_STATUS_LABELS: Readonly<Record<string, string>> = {
  reserved: "准备中",
  "core-staged": "准备中",
  "filesystem-promoted": "准备中",
  "runtime-bound": "准备中",
  failed: "创建失败",
  "compensation-required": "需要修复",
};

export function bookShelfStatusLabel(status: string | undefined | null): string | null {
  if (!status || status === "ready") return null;
  return BOOK_SHELF_STATUS_LABELS[status] ?? "状态异常";
}

export interface BookManagementPageProps {
  readonly books: readonly ManagedBook[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onNavigateToBook: (bookId: string) => void;
  readonly onCreateBook: (input?: WorkspaceCreateInput) => Promise<void> | void;
  readonly onClaimLegacyBook: (
    bookId: string,
  ) => Promise<RuntimeBookProvisionOperation>;
  readonly onImportBook?: (
    sourcePath: string,
  ) => Promise<RuntimeBookProvisionOperation>;
  readonly onRepairBook: (
    bookId: string,
  ) => Promise<RuntimeBookProvisionOperation>;
  readonly onRebindBookWorkspace: (
    bookId: string,
    workspaceRoot: string,
  ) => Promise<RuntimeRebindBookWorkspaceResult>;
  readonly onDeleteBook: (bookId: string) => Promise<void>;
  /** 项目档案：三个回调齐备时才显示导出 / 导入入口。 */
  readonly loadArchiveModules?: () => Promise<readonly RuntimeBookArchiveModule[]>;
  readonly onExportBookArchive?: (bookId: string, modules: readonly string[]) => Promise<void>;
  readonly onImportBookArchive?: (
    archive: File,
    modules: readonly string[],
  ) => Promise<RuntimeBookArchiveImportResult>;
  /** 导入旧稿（只有正文、没有 book.json）：客户端与建书回调齐备时才显示入口。 */
  readonly manuscriptImportClient?: ManuscriptImportClient;
  /** 为旧稿新建一本空书并返回书 ID。 */
  readonly onCreateManuscriptBook?: (title: string) => Promise<string>;
  /** 导入状态变化后刷新书架。 */
  readonly onBooksChanged?: () => Promise<void> | void;
}

export function BookManagementPage({
  books,
  loading,
  error,
  onNavigateToBook,
  onCreateBook,
  onClaimLegacyBook,
  onImportBook,
  onRepairBook,
  onRebindBookWorkspace,
  onDeleteBook,
  loadArchiveModules,
  onExportBookArchive,
  onImportBookArchive,
  manuscriptImportClient,
  onCreateManuscriptBook,
  onBooksChanged,
}: BookManagementPageProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [legacyBookId, setLegacyBookId] = useState("");
  const [actionBookId, setActionBookId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedBook | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [rebindTarget, setRebindTarget] = useState<ManagedBook | null>(null);
  const [rebindPath, setRebindPath] = useState("");
  const [rebindPickerOpen, setRebindPickerOpen] = useState(false);
  const [archiveExportTarget, setArchiveExportTarget] = useState<ManagedBook | null>(null);
  const [archiveImportOpen, setArchiveImportOpen] = useState(false);
  const archiveExportEnabled = Boolean(loadArchiveModules && onExportBookArchive);
  const archiveImportEnabled = Boolean(loadArchiveModules && onImportBookArchive);
  const manuscriptImportEnabled = Boolean(manuscriptImportClient && onCreateManuscriptBook);
  const [manuscriptOpen, setManuscriptOpen] = useState(false);
  const [manuscriptResume, setManuscriptResume] = useState<{ bookId: string; jobId: string } | null>(null);

  const claimLegacyBook = async () => {
    const bookId = legacyBookId.trim();
    if (!bookId) return;
    setActionBookId(bookId);
    setActionError(null);
    try {
      const operation = await onClaimLegacyBook(bookId);
      setActionMessage(
        `旧作品 ${operation.bookId} 已接管`,
      );
      setLegacyBookId("");
      setClaimOpen(false);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "接管旧作品失败",
      );
    } finally {
      setActionBookId(null);
    }
  };

  const importBook = async () => {
    const sourcePath = importPath.trim();
    if (!sourcePath) return;
    setActionBookId("import");
    setActionError(null);
    try {
      if (!onImportBook) return;
      await onImportBook(sourcePath);
      setActionMessage(
        "作品已导入",
      );
      setImportPath("");
      setImportOpen(false);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "导入作品失败");
    } finally {
      setActionBookId(null);
    }
  };

  const repairBook = async (bookId: string) => {
    setActionBookId(bookId);
    setActionError(null);
    try {
      const operation = await onRepairBook(bookId);
      setActionMessage(
        operation.state === "ready" ? "作品已检查完毕，可以正常打开。" : "作品已检查，仍有问题未修复，请稍后重试。",
      );
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "修复作品绑定失败",
      );
    } finally {
      setActionBookId(null);
    }
  };

  const rebindBook = async () => {
    if (!rebindTarget) return;
    const workspaceRoot = rebindPath.trim();
    if (!workspaceRoot) return;
    setActionBookId(rebindTarget.id);
    setActionError(null);
    try {
      await onRebindBookWorkspace(rebindTarget.id, workspaceRoot);
      setActionMessage(
        `工作目录已修正为：${workspaceRoot}`,
      );
      setRebindTarget(null);
      setRebindPath("");
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "修正作品目录失败",
      );
    } finally {
      setActionBookId(null);
    }
  };

  const deleteBook = async () => {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.title) return;
    setActionBookId(deleteTarget.id);
    setActionError(null);
    try {
      await onDeleteBook(deleteTarget.id);
      // 书籍摘要尚未告诉前端这本书是否位于外部目录，先用对两种书都成立的说法。
      setActionMessage(
        `作品 ${deleteTarget.title} 已删除；你自己文件夹里的文件保留不动。`,
      );
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "删除作品失败");
    } finally {
      setActionBookId(null);
    }
  };

  return (
    <div
      className="flex h-full flex-col gap-6 overflow-auto p-6"
      data-testid="book-management-page"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookOpen className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">我的作品</h1>
            <p className="text-sm text-muted-foreground">
              管理作品、导入已有内容并继续创作。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {archiveImportEnabled ? (
            <Button variant="outline" onClick={() => setArchiveImportOpen(true)}>
              <FileArchive data-icon="inline-start" />
              导入档案
            </Button>
          ) : null}
          {manuscriptImportEnabled ? (
            <Button
              variant="outline"
              onClick={() => {
                setManuscriptResume(null);
                setManuscriptOpen(true);
              }}
            >
              <FileText data-icon="inline-start" />
              导入旧稿
            </Button>
          ) : null}
          {onImportBook ? (
            <Button variant="outline" onClick={() => setPickerOpen(true)}>
              <FolderOpen data-icon="inline-start" />
              导入已有作品
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setClaimOpen(true)}>
            <ShieldCheck data-icon="inline-start" />
            接管旧作品
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新建作品
          </Button>
        </div>
      </header>

      {error ? (
        <Alert className="border-destructive/30">
          <AlertTitle className="text-destructive">作品列表加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert className="border-destructive/30">
          <AlertTitle className="text-destructive">操作失败</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {actionMessage ? (
        <Alert>
          <AlertTitle>操作完成</AlertTitle>
          <AlertDescription>{actionMessage}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="正在加载作品"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : books.length === 0 ? (
        <Card className="mx-auto w-full max-w-lg text-center">
          <CardHeader>
            <CardTitle>还没有可用作品</CardTitle>
            <CardDescription>
              新建作品，或导入已有内容后继续创作。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>新建作品</Button>
            <Button variant="outline" onClick={() => setClaimOpen(true)}>
              接管旧作品
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <Card key={book.id} className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate">{book.title}</CardTitle>
                  {book.manuscriptImportJobId ? (
                    <Badge variant="secondary">导入中</Badge>
                  ) : (() => {
                    const label = bookShelfStatusLabel(book.status);
                    return label ? (
                      <Badge variant="secondary" data-testid="book-shelf-status">{label}</Badge>
                    ) : null;
                  })()}
                </div>
                <CardDescription className="truncate">
                  {book.id}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {book.manuscriptImportJobId && manuscriptImportEnabled ? (
                  <Button
                    onClick={() => {
                      setManuscriptResume({ bookId: book.id, jobId: book.manuscriptImportJobId! });
                      setManuscriptOpen(true);
                    }}
                  >
                    继续导入
                  </Button>
                ) : null}
                <Button
                  variant={book.manuscriptImportJobId && manuscriptImportEnabled ? "outline" : "default"}
                  onClick={() => onNavigateToBook(book.id)}
                >
                  打开工作台
                </Button>
                <Button
                  variant="outline"
                  disabled={actionBookId === book.id}
                  onClick={() => void repairBook(book.id)}
                >
                  <RefreshCw data-icon="inline-start" />
                  {actionBookId === book.id ? "校验中…" : "修复绑定"}
                </Button>
                <Button
                  variant="outline"
                  disabled={actionBookId === book.id}
                  onClick={() => {
                    setRebindTarget(book);
                    setRebindPath("");
                  }}
                >
                  <FolderPen data-icon="inline-start" />
                  修正目录
                </Button>
                {archiveExportEnabled ? (
                  <Button
                    variant="outline"
                    disabled={actionBookId === book.id}
                    onClick={() => setArchiveExportTarget(book)}
                  >
                    <Download data-icon="inline-start" />
                    导出档案
                  </Button>
                ) : null}
                <Button
                  variant="destructive"
                  disabled={actionBookId === book.id}
                  onClick={() => {
                    setDeleteTarget(book);
                    setDeleteConfirmation("");
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                  删除
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {loadArchiveModules && onExportBookArchive ? (
        <BookArchiveExportDialog
          book={archiveExportTarget}
          loadModules={loadArchiveModules}
          onExport={onExportBookArchive}
          onClose={() => setArchiveExportTarget(null)}
          onExported={(message) => {
            setActionError(null);
            setActionMessage(message);
          }}
        />
      ) : null}
      {loadArchiveModules && onImportBookArchive ? (
        <BookArchiveImportDialog
          open={archiveImportOpen}
          loadModules={loadArchiveModules}
          onImport={onImportBookArchive}
          onClose={() => setArchiveImportOpen(false)}
          onOpenBook={onNavigateToBook}
        />
      ) : null}

      {manuscriptImportClient && onCreateManuscriptBook ? (
        <ManuscriptImportDialog
          open={manuscriptOpen}
          resume={manuscriptResume}
          client={manuscriptImportClient}
          createBook={onCreateManuscriptBook}
          onClose={() => setManuscriptOpen(false)}
          onChanged={async () => { await onBooksChanged?.(); }}
          onOpenBook={onNavigateToBook}
        />
      ) : null}

      <WorkspaceCreateWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        submitting={creating}
        onSubmit={async (input) => {
          setCreating(true);
          try { await onCreateBook(input); setCreateOpen(false); } finally { setCreating(false); }
        }}
      />

      <DirectoryPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setImportPath(path);
          setPickerOpen(false);
          setImportOpen(true);
        }}
        initialPath={importPath || undefined}
      />

      <DirectoryPickerDialog
        open={rebindPickerOpen}
        onClose={() => setRebindPickerOpen(false)}
        onSelect={(path) => {
          setRebindPath(path);
          setRebindPickerOpen(false);
        }}
        initialPath={rebindPath || undefined}
      />

      <Dialog
        open={rebindTarget !== null}
        onOpenChange={(open) => {
          if (!open && actionBookId === null) {
            setRebindTarget(null);
            setRebindPath("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修正作品工作目录</DialogTitle>
            <DialogDescription>
              作品文件夹搬过位置时，在这里重新指定它的完整路径。
              {rebindTarget ? (
                <>
                  {" "}
                  当前作品：
                  <strong className="mx-1 text-foreground">
                    {rebindTarget.title}
                  </strong>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rebind-book-path">正确目录</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="rebind-book-path"
                  value={rebindPath}
                  onChange={(event) => setRebindPath(event.target.value)}
                  placeholder="选择这本书所在的文件夹"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRebindPickerOpen(true)}
                >
                  选择目录
                </Button>
              </div>
              <FieldDescription>
                必须是这本书原来的文件夹；修正后不会移动文件。
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={actionBookId !== null}
              onClick={() => {
                setRebindTarget(null);
                setRebindPath("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={
                !rebindTarget || !rebindPath.trim() || actionBookId !== null
              }
              onClick={() => void rebindBook()}
            >
              {actionBookId === rebindTarget?.id ? "修正中…" : "确认修正"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen && Boolean(importPath)}
        onOpenChange={(open) => {
          if (!open) setImportOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入已有作品</DialogTitle>
            <DialogDescription>
              选择作品所在的文件夹，导入后可以接着写。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="import-book-path">作品目录</FieldLabel>
              <Input id="import-book-path" value={importPath} readOnly />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              disabled={actionBookId !== null}
              onClick={() => void importBook()}
            >
              {actionBookId === "import" ? "导入中…" : "确认导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && actionBookId === null) {
            setDeleteTarget(null);
            setDeleteConfirmation("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>永久删除作品</DialogTitle>
            <DialogDescription>
              此操作会删除这本书的全部数据和对话记录，且无法撤销。
              放在默认位置的作品文件会一并删除；放在你自己文件夹里的文件保留不动。请输入作品名
              <strong className="mx-1 text-foreground">
                {deleteTarget?.title}
              </strong>
              进行二次确认。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="delete-book-confirmation">作品名</FieldLabel>
              <Input
                id="delete-book-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={actionBookId !== null}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={
                !deleteTarget ||
                deleteConfirmation !== deleteTarget.title ||
                actionBookId !== null
              }
              onClick={() => void deleteBook()}
            >
              {actionBookId === deleteTarget?.id ? "删除中…" : "永久删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>接管旧作品</DialogTitle>
            <DialogDescription>
              接管已经存在但尚未出现在作品列表中的作品。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(actionError)}>
              <FieldLabel htmlFor="legacy-book-id">作品编号</FieldLabel>
              <Input
                id="legacy-book-id"
                value={legacyBookId}
                onChange={(event) => setLegacyBookId(event.target.value)}
                placeholder="例如：my-legacy-book"
                aria-invalid={Boolean(actionError)}
              />
              <FieldDescription>
                必须是受控根目录中的单一路径段。
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!legacyBookId.trim() || actionBookId !== null}
              onClick={() => void claimLegacyBook()}
            >
              {actionBookId ? "接管中…" : "确认接管"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
