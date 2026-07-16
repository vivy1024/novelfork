import { useState } from "react";
import { BookOpen, Plus, RefreshCw, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { RuntimeBookProvisionOperation, RuntimeBookSummary } from "../runtime/product-contract";

type ManagedBook = Pick<RuntimeBookSummary, "id" | "title" | "status">;

export interface BookManagementPageProps {
  readonly books: readonly ManagedBook[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onNavigateToBook: (bookId: string) => void;
  readonly onCreateBook: () => void;
  readonly onClaimLegacyBook: (bookId: string) => Promise<RuntimeBookProvisionOperation>;
  readonly onRepairBook: (bookId: string) => Promise<RuntimeBookProvisionOperation>;
}

export function BookManagementPage({
  books,
  loading,
  error,
  onNavigateToBook,
  onCreateBook,
  onClaimLegacyBook,
  onRepairBook,
}: BookManagementPageProps) {
  const [claimOpen, setClaimOpen] = useState(false);
  const [legacyBookId, setLegacyBookId] = useState("");
  const [actionBookId, setActionBookId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const claimLegacyBook = async () => {
    const bookId = legacyBookId.trim();
    if (!bookId) return;
    setActionBookId(bookId);
    setActionError(null);
    try {
      const operation = await onClaimLegacyBook(bookId);
      setActionMessage(`旧作品 ${operation.bookId} 已接管，当前状态：${operation.state}`);
      setLegacyBookId("");
      setClaimOpen(false);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "接管旧作品失败");
    } finally {
      setActionBookId(null);
    }
  };

  const repairBook = async (bookId: string) => {
    setActionBookId(bookId);
    setActionError(null);
    try {
      const operation = await onRepairBook(bookId);
      setActionMessage(`作品 ${operation.bookId} 的 Runtime 绑定已校验，当前状态：${operation.state}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "修复作品绑定失败");
    } finally {
      setActionBookId(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6" data-testid="book-management-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookOpen className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">我的作品</h1>
            <p className="text-sm text-muted-foreground">作品身份与叙述者绑定由 Runtime 服务端可信维护。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setClaimOpen(true)}>
            <ShieldCheck data-icon="inline-start" />
            接管旧作品
          </Button>
          <Button onClick={onCreateBook}>
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
          <AlertTitle className="text-destructive">Runtime 操作失败</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {actionMessage ? (
        <Alert>
          <AlertTitle>Runtime 操作完成</AlertTitle>
          <AlertDescription>{actionMessage}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="正在加载作品">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
        </div>
      ) : books.length === 0 ? (
        <Card className="mx-auto w-full max-w-lg text-center">
          <CardHeader>
            <CardTitle>还没有可用作品</CardTitle>
            <CardDescription>新建作品，或由管理员接管受控书籍根目录中的旧作品。</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            <Button onClick={onCreateBook}>新建作品</Button>
            <Button variant="outline" onClick={() => setClaimOpen(true)}>接管旧作品</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <Card key={book.id} className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate">{book.title}</CardTitle>
                  <Badge variant={book.status === "ready" ? "default" : "secondary"}>{book.status ?? "ready"}</Badge>
                </div>
                <CardDescription className="truncate">{book.id}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={() => onNavigateToBook(book.id)}>打开工作台</Button>
                <Button
                  variant="outline"
                  disabled={actionBookId === book.id}
                  onClick={() => void repairBook(book.id)}
                >
                  <RefreshCw data-icon="inline-start" />
                  {actionBookId === book.id ? "校验中…" : "修复绑定"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>接管旧作品</DialogTitle>
            <DialogDescription>
              仅管理员可接管已存在于 Runtime 受控书籍根目录、但尚未绑定的作品。浏览器不会提交文件路径。
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
              <FieldDescription>必须是受控根目录中的单一路径段。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimOpen(false)}>取消</Button>
            <Button disabled={!legacyBookId.trim() || actionBookId !== null} onClick={() => void claimLegacyBook()}>
              {actionBookId ? "接管中…" : "确认接管"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
