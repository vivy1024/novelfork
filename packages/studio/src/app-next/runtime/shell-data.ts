import { createRuntimeProductClient, type RuntimeBootstrap } from "./product-contract";
import {
  createRuntimeNarratorClient,
  type RuntimeNarratorClient,
  type RuntimeNarratorRecord,
  type RuntimeRecentTab,
} from "./runtime-narrator-client";

/** Shell-facing Runtime book data. */
export interface RuntimeShellBookItem {
  readonly id: string;
  readonly title: string;
}

/** A Runtime narrator represented in the ShellSessionItem shape. */
export interface RuntimeShellSessionItem {
  readonly id: string;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly projectId?: string;
  readonly projectName?: string;
  readonly lastModified?: string;
  readonly unread?: boolean;
  readonly working?: boolean;
  readonly pinned?: boolean;
}

/** Minimal provider state needed by Shell consumers. */
export interface RuntimeShellProviderStatus {
  readonly hasUsableModel: boolean;
  readonly label: string;
  readonly [key: string]: unknown;
}

export interface RuntimeShellData {
  readonly books: readonly RuntimeShellBookItem[];
  readonly sessions: readonly RuntimeShellSessionItem[];
  readonly recentTabs: readonly RuntimeRecentTab[];
  readonly providerSummary: null;
  readonly providerStatus: RuntimeShellProviderStatus;
  readonly error: null;
}

export interface RuntimeShellDataClient {
  readonly getBootstrap: () => Promise<RuntimeBootstrap>;
}

export type RuntimeShellNarratorClient = Pick<RuntimeNarratorClient, "listNarrators"> &
  Partial<Pick<RuntimeNarratorClient, "getRecentTabs">>;

function modelLabel(bootstrap: RuntimeBootstrap): string {
  return bootstrap.model.label ?? (bootstrap.model.setupRequired ? "需要配置模型" : "模型已就绪");
}

function standaloneSession(narrator: RuntimeNarratorRecord): RuntimeShellSessionItem {
  return {
    id: narrator.id,
    title: narrator.title,
    status: narrator.status === "archived" ? "archived" : "active",
    lastModified: narrator.lastMessageAt ?? narrator.updatedAt,
    unread: narrator.unread,
    working: narrator.working,
    pinned: narrator.pinned,
  };
}

function compareStandaloneSessions(a: RuntimeNarratorRecord, b: RuntimeNarratorRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.working !== b.working) return a.working ? -1 : 1;
  const aVisited = a.lastVisitedAt ?? 0;
  const bVisited = b.lastVisitedAt ?? 0;
  if (aVisited !== bVisited) return bVisited - aVisited;
  return Date.parse(b.lastMessageAt ?? b.updatedAt) - Date.parse(a.lastMessageAt ?? a.updatedAt);
}

/**
 * Maps trusted book bootstrap plus canonical standalone Runtime narrators into
 * the NovelFork shell shape. Book narrators remain tied to product bootstrap;
 * standalone narrators never acquire a product book binding here.
 */
export function mapRuntimeBootstrapToShellData(
  bootstrap: RuntimeBootstrap,
  standaloneNarrators: readonly RuntimeNarratorRecord[] = [],
  recentTabs: readonly RuntimeRecentTab[] = [],
): RuntimeShellData {
  const books = bootstrap.books
    .filter((book) => book.capabilities.read === true)
    .map((book): RuntimeShellBookItem => ({ id: book.id, title: book.title }));
  const bookNames = new Map(books.map((book) => [book.id, book.title]));

  const bookSessions = bootstrap.narrators
    .filter((narrator) => narrator.capabilities.read === true)
    .map((narrator): RuntimeShellSessionItem => ({
      id: narrator.id,
      title: narrator.title,
      status: narrator.status === "archived" ? "archived" : "active",
      projectId: narrator.bookId,
      projectName: bookNames.get(narrator.bookId),
      lastModified: narrator.updatedAt,
      ...(narrator.status === "working" ? { working: true } : {}),
    }));
  const standaloneSessions = standaloneNarrators
    .filter((narrator) => narrator.binding.kind === "standalone")
    .filter((narrator) => narrator.chapterId === null && narrator.type === "primary" && narrator.variant === "primary")
    .slice()
    .sort(compareStandaloneSessions)
    .map(standaloneSession);

  return {
    books,
    sessions: [...standaloneSessions, ...bookSessions],
    recentTabs,
    providerSummary: null,
    providerStatus: {
      hasUsableModel: !bootstrap.model.setupRequired,
      label: modelLabel(bootstrap),
    },
    error: null,
  };
}

/** Loads book bootstrap and standalone narrators in parallel. */
export async function loadRuntimeShellData(
  client: RuntimeShellDataClient = createRuntimeProductClient(),
  narratorClient: RuntimeShellNarratorClient = createRuntimeNarratorClient(),
  activeNarratorId?: string,
): Promise<RuntimeShellData> {
  const [bootstrap, standaloneNarrators, recentTabs] = await Promise.all([
    client.getBootstrap(),
    narratorClient.listNarrators({ status: "active", sort: "recent", activeNarratorId }),
    narratorClient.getRecentTabs?.() ?? Promise.resolve([]),
  ]);
  return mapRuntimeBootstrapToShellData(bootstrap, standaloneNarrators, recentTabs);
}
