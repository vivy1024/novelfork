/**
 * tauri-api-bridge — intercepts API paths and routes them to TauriStorageAdapter.
 * This allows all existing useApi/fetchJson calls to work in Tauri mode
 * without modifying page components.
 */

import type { ClientStorageAdapter } from "../storage/adapter.js";

let _adapter: ClientStorageAdapter | null = null;

export function setTauriBridge(adapter: ClientStorageAdapter): void {
  _adapter = adapter;
}

export function isTauriBridgeActive(): boolean {
  return _adapter !== null && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Route an API path to the local TauriStorageAdapter.
 * Returns the response data or throws on error.
 */
export async function tauriFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!_adapter) throw new Error("Tauri bridge not initialized");

  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  // GET /api/books
  if (path === "/api/books" && method === "GET") {
    const books = await _adapter.listBooks();
    return { books } as T;
  }

  // GET /api/books/:id
  const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
  if (bookMatch && method === "GET") {
    const data = await _adapter.loadBook(bookMatch[1]);
    return data as T;
  }

  // GET /api/books/:id/chapters
  const chaptersMatch = path.match(/^\/api\/books\/([^/]+)\/chapters$/);
  if (chaptersMatch && method === "GET") {
    const data = await _adapter.loadBook(chaptersMatch[1]);
    return { chapters: data.chapters } as T;
  }

  // GET /api/books/:id/chapters/:num
  const chapterMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)$/);
  if (chapterMatch && method === "GET") {
    const detail = await _adapter.loadChapter(chapterMatch[1], Number(chapterMatch[2]));
    return detail as T;
  }

  // PUT /api/books/:id/chapters/:num
  if (chapterMatch && method === "PUT") {
    await _adapter.saveChapter(chapterMatch[1], Number(chapterMatch[2]), body?.content ?? "");
    return { ok: true } as T;
  }

  // POST /api/books/:id/chapters/:num/approve
  const approveMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)\/approve$/);
  if (approveMatch && method === "POST") {
    await _adapter.approveChapter(approveMatch[1], Number(approveMatch[2]));
    return { ok: true } as T;
  }

  // POST /api/books/:id/chapters/:num/reject
  const rejectMatch = path.match(/^\/api\/books\/([^/]+)\/chapters\/(\d+)\/reject$/);
  if (rejectMatch && method === "POST") {
    await _adapter.rejectChapter(rejectMatch[1], Number(rejectMatch[2]));
    return { ok: true } as T;
  }

  // PUT /api/books/:id
  if (bookMatch && method === "PUT") {
    await _adapter.updateBook(bookMatch[1], body);
    return { ok: true } as T;
  }

  // DELETE /api/books/:id
  if (bookMatch && method === "DELETE") {
    await _adapter.deleteBook(bookMatch[1]);
    return { ok: true } as T;
  }

  // GET /api/books/:id/truth
  const truthMatch = path.match(/^\/api\/books\/([^/]+)\/truth$/);
  if (truthMatch && method === "GET") {
    const files = await _adapter.listTruthFiles(truthMatch[1]);
    return { files } as T;
  }

  // GET /api/books/:id/truth/:file
  const truthFileMatch = path.match(/^\/api\/books\/([^/]+)\/truth\/(.+)$/);
  if (truthFileMatch && method === "GET") {
    const content = await _adapter.loadTruthFile(truthFileMatch[1], truthFileMatch[2]);
    return content as T;
  }

  // PUT /api/books/:id/truth/:file
  if (truthFileMatch && method === "PUT") {
    await _adapter.saveTruthFile(truthFileMatch[1], truthFileMatch[2], body?.content ?? "");
    return { ok: true } as T;
  }

  // GET /api/project
  if (path === "/api/project" && method === "GET") {
    const config = await _adapter.loadProject();
    return config as T;
  }

  // PUT /api/project
  if (path === "/api/project" && method === "PUT") {
    await _adapter.updateProject(body);
    return { ok: true } as T;
  }

  // POST /api/project/language
  if (path === "/api/project/language" && method === "POST") {
    await _adapter.updateProject({ language: body?.language });
    return { ok: true } as T;
  }

  // GET /api/auth/me — always authenticated in Tauri
  if (path === "/api/auth/me") {
    return { session: { userId: 0, email: "local" } } as T;
  }

  // GET /api/mode
  if (path === "/api/mode") {
    return { mode: "tauri" } as T;
  }

  // GET /api/daemon — no daemon in Tauri mode
  if (path === "/api/daemon") {
    return { running: false } as T;
  }

  // Fallback — unsupported route
  throw new Error(`Tauri bridge: unsupported route ${method} ${path}`);
}