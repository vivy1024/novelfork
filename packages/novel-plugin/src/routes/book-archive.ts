/**
 * 项目档案路由。
 *
 * GET  /api/novelfork/book-archives/modules        可选模块清单（界面据此渲染勾选项）
 * GET  /api/books/:bookId/archive?modules=a,b      导出为单个 zip 档案并下载；省略 modules 即全选
 * POST /api/novelfork/book-archives/import?modules=a,b
 *      请求体为档案 zip 原始字节；只能导入为新书，不覆盖已有作品。
 *
 * 导出路由挂在 /api/books/:bookId 之下，由宿主的书籍访问守卫先校验归属；作品目录只经
 * 服务端可信绑定（resolveBookRoot）解析，前端与模型都不传路径。导入的建书、目录转正与
 * Runtime 绑定由产品层通过 importArchive 注入，这里只负责解析请求与统一的错误说明。
 */
import { Hono, type Context } from "hono";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";

import {
  BOOK_ARCHIVE_MODULES,
  BookArchiveError,
  exportBookArchive,
  isBookArchiveModuleId,
  type BookArchiveImportReport,
  type BookArchiveModuleId,
} from "../engine/book-archive/index.js";

/** 上传档案的大小上限：足够容纳数百万字的正文与全部记忆数据，又不至于拖垮进程内存。 */
export const MAX_BOOK_ARCHIVE_UPLOAD_BYTES = 256 * 1024 * 1024;

export interface BookArchiveImportRequest {
  readonly bytes: Uint8Array;
  readonly modules?: readonly BookArchiveModuleId[];
  readonly idempotencyKey: string;
}

export interface BookArchiveImportResult {
  readonly operation: unknown;
  readonly report: BookArchiveImportReport | null;
}

export interface CreateBookArchiveRouterOptions {
  readonly storage?: StorageDatabase;
  /** 服务端可信绑定解析作品根目录。 */
  readonly resolveBookRoot: (bookId: string) => string;
  readonly novelforkVersion: string;
  /** 导入为新书；不提供时导入路由不挂载。 */
  readonly importArchive?: (c: Context, request: BookArchiveImportRequest) => Promise<BookArchiveImportResult>;
}

function archiveError(c: Context, error: BookArchiveError, status: 400 | 413 = 400): Response {
  // message 供通用错误解析读取；explanation 是按约定给界面与叙述者展示的原文。
  return c.json({ error: error.code, code: error.code, message: error.explanation, summary: error.explanation, explanation: error.explanation }, status);
}

function parseModules(raw: string | undefined): readonly BookArchiveModuleId[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const invalid = values.filter((value) => !isBookArchiveModuleId(value));
  if (invalid.length > 0) {
    throw new BookArchiveError(
      "invalid-modules",
      `不认识的档案模块：${invalid.join("、")}。可选模块为 ${BOOK_ARCHIVE_MODULES.map((module) => `${module.id}（${module.label}）`).join("、")}。`,
    );
  }
  return values as BookArchiveModuleId[];
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]+/gu, "_").replace(/["\\]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createBookArchiveRouter(options: CreateBookArchiveRouterOptions): Hono {
  const app = new Hono();
  const storage = () => options.storage ?? getStorageDatabase();

  app.get("/api/novelfork/book-archives/modules", (c) => c.json({ modules: BOOK_ARCHIVE_MODULES }));

  app.get("/api/books/:bookId/archive", async (c) => {
    const bookId = c.req.param("bookId");
    try {
      const modules = parseModules(c.req.query("modules"));
      const result = await exportBookArchive({
        storage: storage(),
        bookRoot: options.resolveBookRoot(bookId),
        bookId,
        novelforkVersion: options.novelforkVersion,
        ...(modules ? { modules } : {}),
      });
      return c.body(result.bytes as Uint8Array<ArrayBuffer>, 200, {
        "content-type": "application/zip",
        "content-disposition": contentDisposition(result.fileName),
        "cache-control": "no-store",
      });
    } catch (error) {
      if (error instanceof BookArchiveError) return archiveError(c, error);
      throw error;
    }
  });

  if (options.importArchive) {
    const importArchive = options.importArchive;
    app.post("/api/novelfork/book-archives/import", async (c) => {
      try {
        const modules = parseModules(c.req.query("modules"));
        const idempotencyKey = c.req.header("Idempotency-Key")?.trim() ?? "";
        if (!idempotencyKey || idempotencyKey.length > 200) {
          throw new BookArchiveError("idempotency-key-required", "导入请求缺少 Idempotency-Key 请求头，无法防止重复导入。请刷新页面后重试。");
        }
        const declared = Number(c.req.header("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > MAX_BOOK_ARCHIVE_UPLOAD_BYTES) {
          return archiveError(c, new BookArchiveError("archive-too-large", `档案超过 ${MAX_BOOK_ARCHIVE_UPLOAD_BYTES / 1024 / 1024} MB 上限，无法导入。`), 413);
        }
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        if (bytes.length > MAX_BOOK_ARCHIVE_UPLOAD_BYTES) {
          return archiveError(c, new BookArchiveError("archive-too-large", `档案超过 ${MAX_BOOK_ARCHIVE_UPLOAD_BYTES / 1024 / 1024} MB 上限，无法导入。`), 413);
        }
        if (bytes.length === 0) throw new BookArchiveError("archive-empty", "没有收到档案内容。请重新选择 .zip 档案后再导入。");
        const result = await importArchive(c, { bytes, idempotencyKey, ...(modules ? { modules } : {}) });
        return c.json(result, 201);
      } catch (error) {
        if (error instanceof BookArchiveError) return archiveError(c, error);
        throw error;
      }
    });
  }

  return app;
}
