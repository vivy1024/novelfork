import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export interface CollaborationSession {
  id: string;
  parentSessionId?: string;
  title: string;
  status: string;
  agentId: string;
  lastModified: string;
}

export interface SessionTreeNode {
  session: CollaborationSession;
  children: SessionTreeNode[];
}

export interface GitWorktreeSummary {
  path: string;
  branch?: string;
  status?: { modified?: number; added?: number; deleted?: number; untracked?: number };
}

export interface GitCommitSummary {
  hash: string;
  short: string;
  message: string;
  author: string;
  date: string;
}

export function buildSessionForest(sessions: readonly CollaborationSession[]): SessionTreeNode[] {
  const nodes = new Map(sessions.map((session) => [session.id, { session, children: [] as SessionTreeNode[] }]));
  const roots: SessionTreeNode[] = [];
  const hasAncestor = (session: CollaborationSession, ancestorId: string): boolean => {
    const visited = new Set<string>();
    let parentId = session.parentSessionId;
    while (parentId && !visited.has(parentId)) {
      if (parentId === ancestorId) return true;
      visited.add(parentId);
      parentId = nodes.get(parentId)?.session.parentSessionId;
    }
    return false;
  };

  for (const session of sessions) {
    const node = nodes.get(session.id)!;
    const parent = session.parentSessionId ? nodes.get(session.parentSessionId) : undefined;
    if (parent && parent !== node && !hasAncestor(parent.session, session.id)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function errorMessage(label: string): string {
  return `${label}加载失败`;
}

async function readJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(errorMessage(label));
  return response.json() as Promise<T>;
}

function formatLastModified(value: string): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function dirtyCount(worktree: GitWorktreeSummary): number {
  const status = worktree.status;
  return (status?.modified ?? 0) + (status?.added ?? 0) + (status?.deleted ?? 0) + (status?.untracked ?? 0);
}

function SessionNodeView({ node, depth = 0 }: { node: SessionTreeNode; depth?: number }) {
  return (
    <div className="relative" style={{ marginLeft: depth ? 22 : 0 }}>
      {depth > 0 ? (
        <span
          data-testid={`session-edge-${node.session.id}`}
          aria-hidden="true"
          className="absolute -left-[14px] top-0 h-5 w-3 border-b border-l border-border"
        />
      ) : null}
      <div className="rounded-md border border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{node.session.title}</span>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{node.session.status}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{node.session.agentId || "未指定 Agent"}</span>
          <span>{formatLastModified(node.session.lastModified)}</span>
        </div>
      </div>
      {node.children.length > 0 ? <div className="mt-2 space-y-2">{node.children.map((child) => <SessionNodeView key={child.session.id} node={child} depth={depth + 1} />)}</div> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section role="region" aria-label={title} className="rounded-lg border border-border bg-background p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function CollaborationVersionPanel({ bookId, repositoryPath }: { bookId: string; repositoryPath?: string }) {
  const [sessions, setSessions] = useState<CollaborationSession[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktreeSummary[]>([]);
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [resolvedRepoPath, setResolvedRepoPath] = useState<string | undefined>(repositoryPath);
  const [errors, setErrors] = useState<{ sessions?: string; worktrees?: string; commits?: string }>({});
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors({});

    // Product Runtime: book narrators live under /api/books/:bookId/narrators.
    // Legacy Studio /api/sessions?projectId=bookId is retired.
    type NarratorRow = {
      id: string;
      title: string;
      status: string;
      model?: string | null;
      updatedAt?: string;
      createdAt?: string;
    };
    const sessionRequest = readJson<{ narrators?: NarratorRow[] } | NarratorRow[]>(
      `/api/books/${encodeURIComponent(bookId)}/narrators`,
      "会话协作关系",
    ).then((payload): CollaborationSession[] => {
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.narrators)
          ? payload.narrators
          : [];
      return rows.map((row) => ({
        id: row.id,
        title: row.title || row.id,
        status: row.status || "unknown",
        agentId: row.model || "narrator",
        lastModified: row.updatedAt || row.createdAt || "",
      }));
    });

    // Resolve repository path from product binding when the workbench did not
    // pass one (external books rely on book_runtime_bindings.book_root).
    const contextRequest = repositoryPath
      ? Promise.resolve({
          repositoryPath,
          worktrees: [] as GitWorktreeSummary[],
        })
      : readJson<{ repositoryPath?: string; worktreeRoot?: string }>(
          `/api/books/${encodeURIComponent(bookId)}/collaboration-context`,
          "Git worktree",
        ).then((ctx) => ({
          repositoryPath: ctx.repositoryPath,
          worktrees: ctx.worktreeRoot
            ? ([{ path: ctx.worktreeRoot }] as GitWorktreeSummary[])
            : [],
        }));

    const [sessionResult, contextResult] = await Promise.allSettled([
      sessionRequest,
      contextRequest,
    ]);

    if (sessionResult.status === "fulfilled") setSessions(sessionResult.value);
    else {
      setSessions([]);
      setErrors((current) => ({ ...current, sessions: errorMessage("会话协作关系") }));
    }

    if (contextResult.status === "fulfilled") {
      setResolvedRepoPath(contextResult.value.repositoryPath || repositoryPath);
      setWorktrees(contextResult.value.worktrees ?? []);
    } else {
      setResolvedRepoPath(repositoryPath);
      setWorktrees([]);
      if (!repositoryPath) {
        setErrors((current) => ({ ...current, worktrees: errorMessage("Git worktree") }));
      }
    }

    // Product Runtime does not yet expose /api/git/log — keep empty with UI notice.
    setCommits([]);
    setLoading(false);
  }, [bookId, repositoryPath]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const forest = buildSessionForest(sessions);

  return (
    <div className="space-y-3" data-testid="collaboration-version-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">会话分叉、工作树与当前仓库版本概览</p>
        <button
          type="button"
          aria-label="刷新协作与版本"
          disabled={loading}
          onClick={() => setRefreshKey((value) => value + 1)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {loading ? <p role="status" className="text-sm text-muted-foreground">正在加载协作与版本信息…</p> : null}

      <Section title="会话协作关系">
        {errors.sessions ? <p role="alert" className="text-sm text-destructive">{errors.sessions}</p>
          : forest.length > 0 ? <div className="space-y-2">{forest.map((item) => <SessionNodeView key={item.session.id} node={item} />)}</div>
          : !loading ? <p className="text-sm text-muted-foreground">当前书籍没有活跃会话。</p> : null}
      </Section>

      <Section title="Git worktree 分支图">
        {errors.worktrees ? <p role="alert" className="text-sm text-destructive">{errors.worktrees}</p>
          : worktrees.length > 0 ? (
            <div className="relative space-y-2 pl-5 before:absolute before:bottom-4 before:left-[6px] before:top-4 before:w-px before:bg-border">
              {worktrees.map((worktree) => {
                const changes = dirtyCount(worktree);
                return (
                  <div key={worktree.path} className="relative rounded-md border border-border bg-card px-3 py-2 before:absolute before:-left-[15px] before:top-1/2 before:h-px before:w-[14px] before:bg-border">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{worktree.branch || "detached HEAD"}</span>
                      <span className={`text-xs ${changes ? "text-amber-600" : "text-emerald-600"}`}>{changes ? `有改动 · ${changes}` : "干净"}</span>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{worktree.path}</p>
                  </div>
                );
              })}
            </div>
          ) : !loading ? <p className="text-sm text-muted-foreground">没有可显示的 worktree。</p> : null}
      </Section>

      <Section title="Git 提交版本时间轴">
        {!resolvedRepoPath ? (
          <p className="text-sm text-muted-foreground">未绑定 repositoryPath，无法读取提交历史。</p>
        ) : errors.commits ? (
          <p role="alert" className="text-sm text-destructive">{errors.commits}</p>
        ) : commits.length > 0 ? (
          <ol className="relative space-y-3 pl-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
            {commits.map((commit) => (
              <li key={commit.hash} className="relative before:absolute before:-left-[18px] before:top-1.5 before:size-2 before:rounded-full before:bg-primary">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="text-xs text-primary">{commit.short}</code>
                  <span className="text-sm font-medium">{commit.message}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{commit.author} · {commit.date}</p>
              </li>
            ))}
          </ol>
        ) : !loading ? (
          <p className="text-sm text-muted-foreground">
            仓库路径已绑定（{resolvedRepoPath}）。当前产品 Runtime 未暴露 Git 提交历史 API，可在本地 Git 客户端查看。
          </p>
        ) : null}
      </Section>
    </div>
  );
}
