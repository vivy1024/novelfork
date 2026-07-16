import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, FileText, Loader2, MessageCircle, Plus, RefreshCw } from "lucide-react";

import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { RuntimeAuthGate } from "./RuntimeAuthGate";
import { RuntimeNarratorConversation } from "./RuntimeNarratorConversation";
import {
  createRuntimeProductClient,
  isRuntimeBookProvisionTerminal,
  type RuntimeBookProvisionOperation,
  type RuntimeBookSummary,
  type RuntimeBootstrap,
  type RuntimeNarratorSummary,
  type RuntimeProductClient,
  type RuntimeWorkspaceSnapshot,
} from "../runtime/product-contract";

function NarratorList({
  narrators,
  selectedId,
  onSelect,
}: {
  readonly narrators: readonly RuntimeNarratorSummary[];
  readonly selectedId?: string;
  readonly onSelect: (narrator: RuntimeNarratorSummary) => void;
}) {
  if (narrators.length === 0) return <p className="px-3 py-2 text-xs text-muted-foreground">此书尚无叙述者。</p>;
  return (
    <div className="space-y-1">
      {narrators.map((narrator) => (
        <button
          key={narrator.id}
          type="button"
          onClick={() => onSelect(narrator)}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedId === narrator.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
        >
          <MessageCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{narrator.title}</span>
          <span className="text-[11px] text-muted-foreground">{narrator.status ?? "idle"}</span>
        </button>
      ))}
    </div>
  );
}

function ProvisionNotice({
  operation,
  error,
  onRetry,
  retrying,
}: {
  readonly operation: RuntimeBookProvisionOperation;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}) {
  const stateLabel: Record<RuntimeBookProvisionOperation["state"], string> = {
    reserved: "正在预留作品",
    "core-staged": "正在建立作品资料",
    "filesystem-promoted": "正在准备作品工作区",
    "runtime-bound": "正在绑定小说创作助手",
    ready: "作品已准备完成",
    failed: "作品创建失败",
    "compensation-required": "作品创建需要修复",
  };
  const terminalFailure = operation.state === "failed" || operation.state === "compensation-required";
  return (
    <div role={terminalFailure || error ? "alert" : "status"} className={`mt-4 rounded-md border p-3 text-sm ${terminalFailure || error ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-blue-500/30 bg-blue-500/5 text-foreground"}`}>
      <div className="flex items-center gap-2">
        {!isRuntimeBookProvisionTerminal(operation.state) && <Loader2 className="size-4 animate-spin" />}
        <span className="font-medium">{stateLabel[operation.state]}：{operation.bookId}</span>
      </div>
      {(operation.error || error) && <p className="mt-1 text-xs">{operation.error ?? error}</p>}
      {terminalFailure && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry} disabled={retrying}>{retrying ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}重试 provision</Button>}
    </div>
  );
}

function RuntimeWorkspace({ book, client }: { readonly book: RuntimeBookSummary; readonly client: Pick<RuntimeProductClient, "getWorkspace"> }) {
  const [state, setState] = useState<{ loading: boolean; data: RuntimeWorkspaceSnapshot | null; error: string | null }>({ loading: true, data: null, error: null });
  const reload = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    try {
      const data = await client.getWorkspace(book.id);
      setState({ loading: false, data, error: null });
    } catch (caught) {
      setState({ loading: false, data: null, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [book.id, client]);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" data-testid="runtime-workspace">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">{book.title} · 工作台资源</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">P0 为只读视图；编辑能力由 Runtime 后续能力声明开放。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={state.loading}>
          <RefreshCw className={`mr-1.5 size-3.5 ${state.loading ? "animate-spin" : ""}`} />刷新
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {state.loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载 Runtime 工作台资源…</p>}
        {state.error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">无法加载工作台资源：{state.error}</p>}
        {state.data && (
          <div className="max-w-3xl space-y-2">
            {state.data.resources.length === 0 ? <p className="text-sm text-muted-foreground">暂无可读取资源。</p> : state.data.resources.map((resource) => (
              <article key={resource.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4" />{resource.title}</div>
                <p className="mt-1 text-xs text-muted-foreground">{resource.kind}{resource.path ? ` · ${resource.path}` : ""}</p>
                {resource.content && <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{resource.content}</pre>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RuntimeP0Shell() {
  const client = useMemo(() => createRuntimeProductClient(), []);
  const [bootstrap, setBootstrap] = useState<RuntimeBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [selectedNarratorId, setSelectedNarratorId] = useState<string | null>(null);
  const selectedBookIdRef = useRef<string | null>(null);
  useEffect(() => { selectedBookIdRef.current = selectedBookId; }, [selectedBookId]);
  const [view, setView] = useState<"home" | "workspace">("home");
  const [newBookOpen, setNewBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [provision, setProvision] = useState<RuntimeBookProvisionOperation | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);

  const reload = useCallback(async (preferredBookId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await client.getBootstrap();
      setBootstrap(next);
      const currentBookId = selectedBookIdRef.current;
      const nextBookId = preferredBookId && next.books.some((book) => book.id === preferredBookId)
        ? preferredBookId
        : currentBookId && next.books.some((book) => book.id === currentBookId) ? currentBookId : next.books[0]?.id ?? null;
      setSelectedBookId(nextBookId);
      setSelectedNarratorId(nextBookId ? next.narrators.find((narrator) => narrator.bookId === nextBookId && narrator.capabilities.read)?.id ?? null : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void reload(); }, [reload]);

  const openCreateBook = () => {
    setNewBookTitle("");
    setCreateKey(null);
    setProvisionError(null);
    setNewBookOpen(true);
  };

  const applyProvision = useCallback(async (operation: RuntimeBookProvisionOperation) => {
    setProvision(operation);
    setProvisionError(null);
    if (operation.state === "ready") {
      setNewBookOpen(false);
      setCreateKey(null);
      await reload(operation.bookId);
    }
  }, [reload]);

  const submitCreateBook = async () => {
    const title = newBookTitle.trim();
    if (!title || creating) return;
    const key = createKey ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `novelfork-book-${Date.now()}`);
    if (!createKey) setCreateKey(key);
    setCreating(true);
    setProvisionError(null);
    try {
      await applyProvision(await client.createBook({ title }, key));
    } catch (caught) {
      setProvisionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  };

  const retryProvision = async () => {
    if (!provision || creating) return;
    setCreating(true);
    setProvisionError(null);
    try {
      await applyProvision(await client.retryBookProvision(provision.bookId));
    } catch (caught) {
      setProvisionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!provision || isRuntimeBookProvisionTerminal(provision.state)) return undefined;
    const timer = window.setTimeout(() => {
      void client.getBookStatus(provision.bookId).then(
        async (operation) => { await applyProvision(operation); },
        (caught: unknown) => setProvisionError(caught instanceof Error ? caught.message : String(caught)),
      ).finally(() => setPollTick((current) => current + 1));
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [applyProvision, client, pollTick, provision]);

  const selectedBook = bootstrap?.books.find((book) => book.id === selectedBookId) ?? null;
  const selectedNarrator = bootstrap?.narrators.find((narrator) => narrator.id === selectedNarratorId) ?? null;
  const bookNarrators = selectedBook ? (bootstrap?.narrators.filter((narrator) => narrator.bookId === selectedBook.id) ?? []) : [];
  return (
    <main className="flex h-screen min-h-0 bg-background" data-testid="runtime-p0-shell">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="border-b border-border px-4 py-4">
          <p className="text-xs font-medium text-muted-foreground">NovelFork</p>
          <h1 className="mt-0.5 text-lg font-semibold">Runtime 工作台</h1>
          {bootstrap && <p className="mt-1 text-xs text-muted-foreground">模型：{bootstrap.model.setupRequired ? "需要配置" : bootstrap.model.label ?? "已就绪"}</p>}
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="书籍与叙述者">
          {bootstrap && <Button type="button" variant="outline" className="mb-3 w-full justify-start" onClick={openCreateBook}><Plus className="mr-2 size-4" />新建作品</Button>}
          {loading && <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载工作台…</p>}
          {!loading && bootstrap?.books.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Runtime 中没有可读取的书籍。</p>}
          {bootstrap?.books.map((book) => {
            const active = book.id === selectedBookId;
            const narrators = bootstrap.narrators.filter((narrator) => narrator.bookId === book.id && narrator.capabilities.read);
            return (
              <section key={book.id} className="mb-2">
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium ${active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                  onClick={() => { setSelectedBookId(book.id); setSelectedNarratorId(bootstrap.narrators.find((narrator) => narrator.bookId === book.id && narrator.capabilities.read)?.id ?? null); setView("home"); }}
                >
                  <BookOpen className="size-4" /><span className="min-w-0 flex-1 truncate">{book.title}</span><ChevronRight className="size-3.5" />
                </button>
                {active && <div className="mt-1 pl-2"><NarratorList narrators={narrators} selectedId={selectedNarratorId ?? undefined} onSelect={(narrator) => { setSelectedNarratorId(narrator.id); setView("home"); }} /></div>}
              </section>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-border p-3">
          {provision && <ProvisionNotice operation={provision} error={provisionError} onRetry={() => void retryProvision()} retrying={creating} />}
          {selectedBook && bootstrap?.capabilities.workspace.read && <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setView("workspace")}><FileText className="mr-2 size-4" />读取工作台资源</Button>}
          <Button type="button" variant="outline" className="w-full justify-start" onClick={() => void reload()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />刷新 Runtime 数据</Button>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        {error && <div role="alert" className="m-4 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"><span>{error}</span><Button type="button" size="sm" variant="ghost" onClick={() => void reload()}>重试</Button></div>}
        {!loading && !error && view === "workspace" && selectedBook && bootstrap?.capabilities.workspace.read && <RuntimeWorkspace book={selectedBook} client={client} />}
        {!loading && !error && view === "home" && selectedNarrator && <RuntimeNarratorConversation key={selectedNarrator.id} bookId={selectedNarrator.bookId} narrator={selectedNarrator} client={client} />}
        {!loading && !error && view === "home" && !selectedNarrator && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
              <p className="text-xs font-medium text-muted-foreground">{selectedBook ? selectedBook.title : "NovelFork"}</p>
              <h2 className="mt-1 text-xl font-semibold">选择一个叙述者开始创作</h2>
              <p className="mt-2 text-sm text-muted-foreground">叙述者、书籍和模型状态均来自 Runtime bootstrap；P0 不调用旧 Studio session、provider 或 onboarding 接口。</p>
              {bootstrap?.model.setupRequired && <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">Runtime 模型尚未配置。请在 Runtime 管理端完成配置后刷新此页；P0 不提供 provider 或 settings 入口。</p>}
              {selectedBook && <p className="mt-4 text-xs text-muted-foreground">每部作品由 Runtime provision 唯一的只读小说创作助手；P0 不提供叙述者创建、编辑或删除操作。</p>}
            </div>
          </div>
        )}
      </section>

      <Dialog open={newBookOpen} onOpenChange={(open) => { if (!creating) setNewBookOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建作品</DialogTitle>
            <DialogDescription>只需填写书名。Runtime 会创建并绑定唯一的只读小说创作助手。</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); void submitCreateBook(); }} className="space-y-4">
            <Input
              aria-label="作品名称"
              autoFocus
              value={newBookTitle}
              onChange={(event) => setNewBookTitle(event.currentTarget.value)}
              placeholder="输入作品名称"
              disabled={creating || provision?.state === "ready"}
            />
            {provision && <ProvisionNotice operation={provision} error={provisionError} onRetry={() => void retryProvision()} retrying={creating} />}
            {!provision && provisionError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">创建作品失败：{provisionError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewBookOpen(false)} disabled={creating}>取消</Button>
              <Button type="submit" disabled={!newBookTitle.trim() || creating}>
                {creating && <Loader2 className="mr-1.5 size-4 animate-spin" />}创建作品
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** Root adapter for the Runtime-only P0 product shell. */
export function RuntimeP0App() {
  return <RuntimeAuthGate><RuntimeP0Shell /></RuntimeAuthGate>;
}
