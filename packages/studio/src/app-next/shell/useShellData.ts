import { useEffect, useSyncExternalStore } from "react";

import { createContractClient, createProviderClient, createResourceClient, createSessionClient, type ContractResult } from "../backend-contract";
import type { BookListResponse } from "../../shared/contracts";
import type { NarratorSessionRecord } from "../../shared/session-types";
import type { ShellBookItem, ShellSessionItem } from "./shell-route";

export interface ShellDataProviderSummary {
  readonly [key: string]: unknown;
}

export interface ShellDataProviderStatus {
  readonly [key: string]: unknown;
}

export interface UseShellDataResult {
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly providerSummary: ShellDataProviderSummary | null;
  readonly providerStatus: ShellDataProviderStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface ShellDataClients {
  readonly resources: {
    readonly listBooks: () => Promise<ContractResult<BookListResponse>>;
  };
  readonly sessions: {
    readonly listActiveSessions: () => Promise<ContractResult<readonly NarratorSessionRecord[]>>;
  };
  readonly providers: {
    readonly getSummary: () => Promise<ContractResult<ShellDataProviderSummary>>;
    readonly getStatus: () => Promise<ContractResult<ShellDataProviderStatus>>;
  };
}

const EMPTY_SHELL_DATA: UseShellDataResult = {
  books: [],
  sessions: [],
  providerSummary: null,
  providerStatus: null,
  loading: false,
  error: null,
};

type ShellDataInvalidationScope = "all" | "books" | "sessions" | "providers";

type ShellDataListener = () => void;

interface ShellDataStoreSnapshot extends UseShellDataResult {
  readonly revision: number;
}

interface ShellDataStoreActions {
  readonly invalidate: (scope?: ShellDataInvalidationScope) => void;
  readonly upsertSession: (session: NarratorSessionRecord | ShellSessionItem) => void;
}

const shellDataListeners = new Set<ShellDataListener>();
let shellDataSnapshot: ShellDataStoreSnapshot = { ...EMPTY_SHELL_DATA, loading: true, revision: 0 };
let shellDataClients: ShellDataClients | undefined;
let shellDataLoadSeq = 0;

function notifyShellDataListeners() {
  shellDataListeners.forEach((listener) => listener());
}

function setShellDataSnapshot(next: Omit<ShellDataStoreSnapshot, "revision"> | ((current: ShellDataStoreSnapshot) => Omit<ShellDataStoreSnapshot, "revision">)) {
  const resolved = typeof next === "function" ? next(shellDataSnapshot) : next;
  shellDataSnapshot = { ...resolved, revision: shellDataSnapshot.revision + 1 };
  notifyShellDataListeners();
}

function subscribeShellData(listener: ShellDataListener) {
  shellDataListeners.add(listener);
  return () => shellDataListeners.delete(listener);
}

function getShellDataSnapshot() {
  return shellDataSnapshot;
}

function ensureShellDataClients(clients?: ShellDataClients) {
  if (clients) shellDataClients = clients;
  shellDataClients ??= createShellDataClients();
  return shellDataClients;
}

function reloadShellData(clients?: ShellDataClients) {
  const requestSeq = ++shellDataLoadSeq;
  const activeClients = ensureShellDataClients(clients);
  setShellDataSnapshot((current) => ({ ...current, loading: true, error: null }));
  void loadShellData(activeClients).then(
    (result) => {
      if (requestSeq !== shellDataLoadSeq) return;
      setShellDataSnapshot({ ...result, loading: false });
    },
    (error: unknown) => {
      if (requestSeq !== shellDataLoadSeq) return;
      setShellDataSnapshot({ ...EMPTY_SHELL_DATA, error: error instanceof Error ? error.message : String(error), loading: false });
    },
  );
}

function resultError(result: ContractResult<unknown>): string | null {
  if (result.ok) return null;
  if (typeof result.code === "string" && result.code.length > 0) return result.code;
  if (typeof result.error === "string" && result.error.length > 0) return result.error;
  if (result.error && typeof result.error === "object") {
    const message = (result.error as { error?: { message?: unknown }; message?: unknown }).error?.message ?? (result.error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "backend-contract-error";
}

function mapShellSessions(sessions: readonly NarratorSessionRecord[], books: readonly ShellBookItem[]): ShellSessionItem[] {
  return sessions.map((session): ShellSessionItem => ({
    id: session.id,
    title: session.title,
    status: session.status,
    projectId: session.projectId,
    projectName: session.projectId ? books.find((book) => book.id === session.projectId)?.title : undefined,
    agentId: session.agentId,
    lastModified: session.lastModified,
  }));
}

export function createShellDataClients(): ShellDataClients {
  const contract = createContractClient();
  return {
    resources: {
      listBooks: () => createResourceClient(contract).listBooks(),
    },
    sessions: {
      listActiveSessions: () => createSessionClient(contract).listActiveSessions(),
    },
    providers: {
      getSummary: () => createProviderClient(contract).getSummary<ShellDataProviderSummary>(),
      getStatus: () => createProviderClient(contract).getStatus<ShellDataProviderStatus>(),
    },
  };
}

export async function loadShellData(clients: ShellDataClients = createShellDataClients()): Promise<Omit<UseShellDataResult, "loading">> {
  const [booksResult, sessionsResult, providerSummaryResult, providerStatusResult] = await Promise.all([
    clients.resources.listBooks(),
    clients.sessions.listActiveSessions(),
    clients.providers.getSummary(),
    clients.providers.getStatus(),
  ]);

  const error = [booksResult, sessionsResult, providerSummaryResult, providerStatusResult].map(resultError).find(Boolean) ?? null;
  const books = booksResult.ok ? booksResult.data.books ?? [] : [];

  return {
    books,
    sessions: sessionsResult.ok ? mapShellSessions(sessionsResult.data, books) : [],
    providerSummary: providerSummaryResult.ok ? providerSummaryResult.data : null,
    providerStatus: providerStatusResult.ok ? providerStatusResult.data : null,
    error,
  };
}

function toShellSessionItem(session: NarratorSessionRecord | ShellSessionItem, books: readonly ShellBookItem[]): ShellSessionItem {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    projectId: session.projectId,
    projectName: session.projectId ? books.find((book) => book.id === session.projectId)?.title : ("projectName" in session ? session.projectName : undefined),
    agentId: session.agentId,
    lastModified: "lastModified" in session ? session.lastModified : undefined,
  };
}

export function useShellDataStore(): ShellDataStoreActions {
  return {
    invalidate: (scope: ShellDataInvalidationScope = "all") => {
      if (scope === "sessions" || scope === "all") reloadShellData();
      if (scope === "books" || scope === "providers") reloadShellData();
    },
    upsertSession: (session) => {
      setShellDataSnapshot((current) => {
        const nextSession = toShellSessionItem(session, current.books);
        const sessions = current.sessions.some((candidate) => candidate.id === nextSession.id)
          ? current.sessions.map((candidate) => (candidate.id === nextSession.id ? nextSession : candidate))
          : [nextSession, ...current.sessions];
        return { ...current, sessions };
      });
    },
  };
}

export function useShellData(clients?: ShellDataClients): UseShellDataResult {
  const snapshot = useSyncExternalStore(subscribeShellData, getShellDataSnapshot, getShellDataSnapshot);

  useEffect(() => {
    reloadShellData(clients);
  }, [clients]);

  return snapshot;
}
