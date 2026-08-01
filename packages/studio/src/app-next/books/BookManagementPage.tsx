import { useState } from "react";
import {
  BookOpen,
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
import type {
  RuntimeBookProvisionOperation,
  RuntimeBookSummary,
  RuntimeRebindBookWorkspaceResult,
} from "../runtime/product-contract";

type ManagedBook = Pick<RuntimeBookSummary, "id" | "title" | "status">;

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
  readonly onDeleteBook: (bookId: string, deleteWorkspace?: boolean) => Promise<void>;
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
  const [deleteWorkspace, setDeleteWorkspace] = useState(false);
  const [rebindTarget, setRebindTarget] = useState<ManagedBook | null>(null);
  const [rebindPath, setRebindPath] = useState("");
  const [rebindPickerOpen, setRebindPickerOpen] = useState(false);

  const claimLegacyBook = async () => {
    const bookId = legacyBookId.trim();
    if (!bookId) return;
    setActionBookId(bookId);
    setActionError(null);
    try {
      const operation = await onClaimLegacyBook(bookId);
      setActionMessage(
        `旧作品 ${operation.bookId} 已接管，当前状态：${operation.state}`,
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
      const operation = await onImportBook(sourcePath);
      setActionMessage(
        `作品 ${operation.bookId} 已导入，当前状态：${operation.state}`,
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
        `作品 ${operation.bookId} 的 Runtime 绑定已校验，当前状态：${operation.state}`,
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
      const result = await onRebindBookWorkspace(rebindTarget.id, workspaceRoot);
      setActionMessage(
        `作品 ${result.bookId} 工作目录已修正为：${workspaceRoot}`,
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
      await onDeleteBook(deleteTarget.id, deleteWorkspace);
      setActionMessage(`作品 ${deleteTarget.title} 已永久删除`);
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
                  <Badge
                    variant={book.status === "ready" ? "default" : "secondary"}
                  >
                    {book.status ?? "ready"}
                  </Badge>
                </div>
                <CardDescription className="truncate">
                  {book.id}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={() => onNavigateToBook(book.id)}>
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
                <Button
                  variant="destructive"
                  disabled={actionBookId === book.id}
                  onClick={() => {
                    setDeleteTarget(book);
                    setDeleteConfirmation("");
                    setDeleteWorkspace(false);
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
              当作品目录迁移或绑定路径错误时，选择正确的绝对路径。服务端会重写
              book_root、Runtime 项目路径，并标记为外部 workspace。
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
                  placeholder="选择包含 book.json 的作品目录"
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
                目录内 book.json 的 id 必须与当前作品一致；修正后不会移动文件。
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
              选择包含 book.json 的作品目录；导入后可在工作台继续编辑。
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
              此操作会删除作品文件、Runtime 会话和绑定，且无法撤销。请输入作品名
              <strong className="mx-1 text-foreground">
                {deleteTarget?.title}
              </strong>
              进行二次确认。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="delete-book-confirmation">作品名</FieldLabel>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deleteWorkspace} onChange={(event) => setDeleteWorkspace(event.target.checked)} />同时删除 workspace 目录（默认仅解绑）</label>
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
              <FieldLabel htmlFor="legacy-book-id">Book ID</FieldLabel>
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
