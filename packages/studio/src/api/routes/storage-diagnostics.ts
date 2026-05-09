import { Hono } from "hono";
import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveRuntimeStoragePath } from "../lib/runtime-storage-paths.js";

interface DatabaseInfo {
  name: string;
  path: string;
  sizeBytes: number;
}

interface DirectoryInfo {
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

async function getDirectoryStats(dirPath: string): Promise<{ sizeBytes: number; fileCount: number }> {
  let sizeBytes = 0;
  let fileCount = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      if (entry.isFile()) {
        fileCount++;
        const s = await stat(entryPath);
        sizeBytes += s.size;
      } else if (entry.isDirectory()) {
        const sub = await getDirectoryStats(entryPath);
        sizeBytes += sub.sizeBytes;
        fileCount += sub.fileCount;
      }
    }
  } catch {
    // directory doesn't exist or not accessible
  }

  return { sizeBytes, fileCount };
}

export function createStorageDiagnosticsRouter() {
  const app = new Hono();

  // GET /diagnostics — 获取存储诊断信息
  app.get("/diagnostics", async (c) => {
    const dataDir = resolveRuntimeStoragePath();

    const databases: DatabaseInfo[] = [];
    const directories: DirectoryInfo[] = [];

    // novelfork.db
    const mainDbPath = join(dataDir, "novelfork.db");
    const mainDbSize = await getFileSize(mainDbPath);
    if (mainDbSize > 0) {
      databases.push({ name: "主数据库", path: mainDbPath, sizeBytes: mainDbSize });
    }

    // novelfork-search.db
    const searchDbPath = join(dataDir, "novelfork-search.db");
    const searchDbSize = await getFileSize(searchDbPath);
    if (searchDbSize > 0) {
      databases.push({ name: "搜索索引", path: searchDbPath, sizeBytes: searchDbSize });
    }

    // checkpoints 目录
    const checkpointsPath = resolveRuntimeStoragePath("checkpoints");
    const checkpointsStats = await getDirectoryStats(checkpointsPath);
    if (checkpointsStats.fileCount > 0) {
      directories.push({ name: "检查点", path: checkpointsPath, ...checkpointsStats });
    }

    // session-history 目录
    const sessionHistoryPath = resolveRuntimeStoragePath("session-history");
    const sessionHistoryStats = await getDirectoryStats(sessionHistoryPath);
    if (sessionHistoryStats.fileCount > 0) {
      directories.push({ name: "会话历史", path: sessionHistoryPath, ...sessionHistoryStats });
    }

    // uploads 目录
    const uploadsPath = resolveRuntimeStoragePath("uploads");
    const uploadsStats = await getDirectoryStats(uploadsPath);
    if (uploadsStats.fileCount > 0) {
      directories.push({ name: "上传文件", path: uploadsPath, ...uploadsStats });
    }

    // sessions 目录
    const sessionsPath = resolveRuntimeStoragePath("sessions");
    const sessionsStats = await getDirectoryStats(sessionsPath);
    if (sessionsStats.fileCount > 0) {
      directories.push({ name: "会话数据", path: sessionsPath, ...sessionsStats });
    }

    // transcripts 目录
    const transcriptsPath = resolveRuntimeStoragePath("transcripts");
    const transcriptsStats = await getDirectoryStats(transcriptsPath);
    if (transcriptsStats.fileCount > 0) {
      directories.push({ name: "对话记录", path: transcriptsPath, ...transcriptsStats });
    }

    const totalBytes =
      databases.reduce((sum, db) => sum + db.sizeBytes, 0) +
      directories.reduce((sum, dir) => sum + dir.sizeBytes, 0);

    return c.json({ databases, directories, totalBytes });
  });

  // POST /vacuum — 对 SQLite 执行 VACUUM
  app.post("/vacuum", async (c) => {
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const db = getStorageDatabase();
      db.sqlite.exec("VACUUM");
      return c.json({ success: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  // POST /cleanup — 清理过期数据
  app.post("/cleanup", async (c) => {
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const db = getStorageDatabase();

      // 清理 30 天前的会话记录
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = db.sqlite.prepare(
        `DELETE FROM "session" WHERE "updatedAt" < ? AND "id" NOT IN (SELECT "id" FROM "session" ORDER BY "updatedAt" DESC LIMIT 50)`,
      ).run(thirtyDaysAgo);

      return c.json({ success: true, deletedSessions: result.changes });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  return app;
}
