/**
 * TauriStorageAdapter — local file I/O via Tauri invoke commands.
 * Used in desktop mode. Books live in user's local workspace folder.
 */

import type {
  ClientStorageAdapter,
  BookSummary,
  BookData,
  ChapterMeta,
  ChapterDetail,
  TruthFileEntry,
  TruthFileContent,
  CreateBookParams,
  BookUpdates,
  ProjectConfig,
} from "./adapter.js";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Dynamic import — @tauri-apps/api only exists in Tauri runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@tauri-apps/api/core") as any;
  return mod.invoke(cmd, args) as T;
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

let _workspace: string | null = null;

export function setWorkspace(path: string): void {
  _workspace = path;
}

export function getWorkspace(): string | null {
  return _workspace;
}

function ws(): string {
  if (!_workspace) throw new Error("Workspace not selected");
  return _workspace;
}

export class TauriStorageAdapter implements ClientStorageAdapter {
  async listBooks(): Promise<ReadonlyArray<BookSummary>> {
    const ids = await invoke<string[]>("list_books", { workspace: ws() });
    const books: BookSummary[] = [];
    for (const id of ids) {
      try {
        const config = await invoke<Record<string, unknown>>("read_book_config", { workspace: ws(), bookId: id });
        const chaptersDir = join(ws(), "books", id, "chapters");
        const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir }).catch(() => []);
        const chapterCount = entries.filter(e => !e.is_dir && e.name.endsWith(".md") && /^\d{4}/.test(e.name)).length;
        books.push({
          id,
          title: (config.title as string) ?? id,
          genre: (config.genre as string) ?? "other",
          status: (config.status as string) ?? "active",
          chapterWordCount: (config.chapterWordCount as number) ?? 3000,
          targetChapters: config.targetChapters as number | undefined,
          chaptersWritten: chapterCount,
          language: config.language as string | undefined,
          fanficMode: config.fanficMode as string | undefined,
        });
      } catch { /* skip broken books */ }
    }
    return books;
  }

  async loadBook(bookId: string): Promise<BookData> {
    const config = await invoke<Record<string, unknown>>("read_book_config", { workspace: ws(), bookId });
    const indexPath = join(ws(), "books", bookId, "chapter_index.json");
    let chapters: ChapterMeta[] = [];
    try {
      const raw = await invoke<string>("read_file_text", { path: indexPath });
      chapters = JSON.parse(raw) as ChapterMeta[];
    } catch { /* no index yet */ }
    const nextChapter = chapters.length > 0 ? Math.max(...chapters.map(c => c.number)) + 1 : 1;
    return {
      book: {
        id: bookId,
        title: (config.title as string) ?? bookId,
        genre: (config.genre as string) ?? "other",
        status: (config.status as string) ?? "active",
        chapterWordCount: (config.chapterWordCount as number) ?? 3000,
        targetChapters: config.targetChapters as number | undefined,
        chaptersWritten: chapters.length,
        language: config.language as string | undefined,
        fanficMode: config.fanficMode as string | undefined,
      },
      chapters,
      nextChapter,
    };
  }
  async createBook(params: CreateBookParams): Promise<{ status: string; bookId: string }> {
    const bookId = params.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "untitled";
    const bookDir = join(ws(), "books", bookId);
    const chaptersDir = join(bookDir, "chapters");
    const storyDir = join(bookDir, "story");

    // Create directories
    await invoke("create_dir_all", { path: chaptersDir });
    await invoke("create_dir_all", { path: storyDir });

    // Write book.json
    const config = {
      id: bookId,
      title: params.title,
      genre: params.genre,
      language: params.language ?? "zh",
      platform: params.platform ?? "other",
      chapterWordCount: params.chapterWordCount ?? 3000,
      targetChapters: params.targetChapters ?? 200,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await invoke("write_file_text", {
      path: join(bookDir, "book.json"),
      content: JSON.stringify(config, null, 2),
    });

    // Write empty chapter index
    await invoke("write_file_text", {
      path: join(bookDir, "chapter_index.json"),
      content: "[]",
    });

    return { status: "ready", bookId };
  }

  async updateBook(bookId: string, updates: BookUpdates): Promise<void> {
    const configPath = join(ws(), "books", bookId, "book.json");
    const raw = await invoke<string>("read_file_text", { path: configPath });
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (updates.chapterWordCount !== undefined) config.chapterWordCount = updates.chapterWordCount;
    if (updates.targetChapters !== undefined) config.targetChapters = updates.targetChapters;
    if (updates.status !== undefined) config.status = updates.status;
    if (updates.language !== undefined) config.language = updates.language;
    config.updatedAt = new Date().toISOString();
    await invoke("write_file_text", { path: configPath, content: JSON.stringify(config, null, 2) });
  }

  async deleteBook(bookId: string): Promise<void> {
    await invoke("delete_path", { path: join(ws(), "books", bookId) });
  }

  async loadChapter(bookId: string, num: number): Promise<ChapterDetail> {
    const chaptersDir = join(ws(), "books", bookId, "chapters");
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir });
    const padded = String(num).padStart(4, "0");
    const match = entries.find(e => e.name.startsWith(padded) && e.name.endsWith(".md"));
    if (!match) throw new Error(`Chapter ${num} not found`);
    const content = await invoke<string>("read_file_text", { path: join(chaptersDir, match.name) });
    return { chapterNumber: num, filename: match.name, content };
  }

  async saveChapter(bookId: string, num: number, content: string): Promise<void> {
    const chaptersDir = join(ws(), "books", bookId, "chapters");
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir });
    const padded = String(num).padStart(4, "0");
    const match = entries.find(e => e.name.startsWith(padded) && e.name.endsWith(".md"));
    if (!match) throw new Error(`Chapter ${num} not found`);
    await invoke("write_file_text", { path: join(chaptersDir, match.name), content });

    // 保存版本快照用于 DiffView
    try {
      const versionsDir = join(chaptersDir, ".versions", padded);
      await invoke("create_dir_all", { path: versionsDir });
      const ts = new Date().toISOString();
      const slug = ts.replace(/[:.]/g, "-");
      const wordCount = this.countWordsSimple(content);
      await invoke("write_file_text", {
        path: join(versionsDir, `${slug}.md`),
        content,
      });
      await invoke("write_file_text", {
        path: join(versionsDir, `${slug}.json`),
        content: JSON.stringify({ timestamp: ts, wordCount }, null, 2),
      });
    } catch {
      // 版本快照失败不阻塞保存
    }
  }

  /** 简易字数统计（中文按字，英文按词） */
  private countWordsSimple(text: string): number {
    const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const english = text.replace(/[\u4e00-\u9fff]/g, "").split(/\s+/).filter(Boolean).length;
    return chinese + english;
  }

  async approveChapter(bookId: string, num: number): Promise<void> {
    await this.updateChapterStatus(bookId, num, "approved");
  }

  async rejectChapter(bookId: string, num: number): Promise<void> {
    await this.updateChapterStatus(bookId, num, "rejected");
  }

  private async updateChapterStatus(bookId: string, num: number, status: string): Promise<void> {
    const indexPath = join(ws(), "books", bookId, "chapter_index.json");
    const raw = await invoke<string>("read_file_text", { path: indexPath });
    const index = JSON.parse(raw) as Array<{ number: number; status: string; [k: string]: unknown }>;
    const updated = index.map(ch => ch.number === num ? { ...ch, status } : ch);
    await invoke("write_file_text", { path: indexPath, content: JSON.stringify(updated, null, 2) });
  }
  async listTruthFiles(bookId: string): Promise<ReadonlyArray<TruthFileEntry>> {
    const storyDir = join(ws(), "books", bookId, "story");
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: storyDir }).catch(() => []);
    const files: TruthFileEntry[] = [];
    for (const e of entries) {
      if (e.is_dir || (!e.name.endsWith(".md") && !e.name.endsWith(".json"))) continue;
      try {
        const content = await invoke<string>("read_file_text", { path: join(storyDir, e.name) });
        files.push({ name: e.name, size: content.length, preview: content.slice(0, 200) });
      } catch { /* skip unreadable */ }
    }
    return files;
  }

  async loadTruthFile(bookId: string, file: string): Promise<TruthFileContent> {
    const path = join(ws(), "books", bookId, "story", file);
    try {
      const content = await invoke<string>("read_file_text", { path });
      return { file, content };
    } catch {
      return { file, content: null };
    }
  }

  async saveTruthFile(bookId: string, file: string, content: string): Promise<void> {
    const path = join(ws(), "books", bookId, "story", file);
    await invoke("write_file_text", { path, content });
  }

  async loadProject(): Promise<ProjectConfig> {
    const configPath = join(ws(), "inkos.json");
    let config: Record<string, unknown> = {};
    try {
      const raw = await invoke<string>("read_file_text", { path: configPath });
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // No inkos.json yet — return defaults
    }
    const llm = (config.llm ?? {}) as Record<string, unknown>;
    return {
      name: (config.name as string) ?? "inkos-studio",
      language: (config.language as string) ?? "zh",
      languageExplicit: "language" in config && config.language !== "",
      model: (llm.model as string) ?? "",
      provider: (llm.provider as string) ?? "openai",
      baseUrl: (llm.baseUrl as string) ?? "",
      stream: llm.stream as boolean | undefined,
      temperature: llm.temperature as number | undefined,
      maxTokens: llm.maxTokens as number | undefined,
    };
  }

  async updateProject(updates: Record<string, unknown>): Promise<void> {
    const configPath = join(ws(), "inkos.json");
    let config: Record<string, unknown> = {};
    try {
      const raw = await invoke<string>("read_file_text", { path: configPath });
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet — start fresh
    }
    const llm = (config.llm ?? {}) as Record<string, unknown>;
    if (updates.temperature !== undefined) llm.temperature = updates.temperature;
    if (updates.maxTokens !== undefined) llm.maxTokens = updates.maxTokens;
    if (updates.stream !== undefined) llm.stream = updates.stream;
    if (updates.language === "zh" || updates.language === "en") config.language = updates.language;
    config.llm = llm;
    await invoke("write_file_text", { path: configPath, content: JSON.stringify(config, null, 2) });
  }
}
