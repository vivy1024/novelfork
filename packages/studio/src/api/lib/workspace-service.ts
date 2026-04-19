/**
 * Workspace Service — sandboxed file operations for the workbench API.
 *
 * All file paths are resolved relative to a workspace root.
 * Rejects path traversal (../), absolute paths, UNC paths, and null bytes.
 * Writes use atomic temp-file → rename pattern.
 */

import { readFile, writeFile, readdir, stat, mkdir, rename, unlink } from "node:fs/promises";
import { join, resolve, relative, sep, posix, normalize } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

export class WorkspaceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSecurityError";
  }
}

/**
 * Resolve a user-supplied path safely within the workspace root.
 * Throws WorkspaceSecurityError on any escape attempt.
 */
export function resolveWithinWorkspace(root: string, input: string): string {
  if (!input || typeof input !== "string") {
    throw new WorkspaceSecurityError("Path is required");
  }

  // Block null bytes
  if (input.includes("\0")) {
    throw new WorkspaceSecurityError("Path contains null bytes");
  }

  // Block UNC paths (\\server\share)
  if (input.startsWith("\\\\") || input.startsWith("//")) {
    throw new WorkspaceSecurityError("UNC paths are not allowed");
  }

  // Block absolute paths
  if (isAbsolute(input)) {
    throw new WorkspaceSecurityError("Absolute paths are not allowed");
  }

  // Normalize separators to OS-native
  const normalized = normalize(input);

  // Resolve against root
  const resolved = resolve(root, normalized);
  const normalizedRoot = resolve(root);

  // Check containment: resolved path must start with root
  const rel = relative(normalizedRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new WorkspaceSecurityError("Path traversal detected");
  }

  return resolved;
}

function isAbsolute(p: string): boolean {
  // Unix absolute
  if (p.startsWith("/")) return true;
  // Windows absolute (C:\ or C:/)
  if (/^[A-Za-z]:[/\\]/.test(p)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

export interface TreeEntry {
  readonly name: string;
  readonly path: string;       // relative to workspace root
  readonly type: "file" | "directory";
  readonly size?: number;      // only for files
  readonly mtime?: string;     // ISO string
  readonly children?: readonly TreeEntry[];
  readonly storyRole?: string; // "book" | "chapter" | "truth" | "snapshot" | "config"
}

/**
 * Build a story-aware project tree.
 * Recognizes InkOS structure: books/, chapters/, story/, snapshots/.
 */
export async function buildProjectTree(
  root: string,
  relDir: string = "",
  depth: number = 4,
): Promise<readonly TreeEntry[]> {
  if (depth <= 0) return [];

  const absDir = relDir ? resolveWithinWorkspace(root, relDir) : resolve(root);
  const entries = await readdir(absDir, { withFileTypes: true });
  const result: TreeEntry[] = [];

  for (const entry of entries) {
    // Skip hidden files, node_modules, .git
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = await buildProjectTree(root, relPath, depth - 1);
      result.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        storyRole: inferDirectoryRole(relPath),
        children,
      });
    } else if (entry.isFile()) {
      const absPath = join(absDir, entry.name);
      const fileStat = await stat(absPath);
      result.push({
        name: entry.name,
        path: relPath,
        type: "file",
        size: fileStat.size,
        mtime: fileStat.mtime.toISOString(),
        storyRole: inferFileRole(relPath, entry.name),
      });
    }
  }

  // Sort: directories first, then by name
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

function inferDirectoryRole(relPath: string): string | undefined {
  const parts = relPath.split("/");
  const last = parts[parts.length - 1];
  if (parts[0] === "books" && parts.length === 2) return "book";
  if (last === "chapters") return "chapters";
  if (last === "story") return "story";
  if (last === "snapshots") return "snapshots";
  if (last === "state") return "state";
  return undefined;
}

function inferFileRole(relPath: string, name: string): string | undefined {
  if (name === "novelfork.json") return "config";
  if (name === "book.json") return "book-config";
  if (name === "chapter-index.json") return "chapter-index";
  if (relPath.includes("/chapters/") && name.endsWith(".md")) return "chapter";
  if (relPath.includes("/story/") && name.endsWith(".md")) return "truth";
  if (name === "memory.db") return "memory-db";
  return undefined;
}

// ---------------------------------------------------------------------------
// File CRUD
// ---------------------------------------------------------------------------

/**
 * Read a file within the workspace.
 */
export async function readWorkspaceFile(
  root: string,
  relPath: string,
): Promise<{ content: string; mtime: string; size: number }> {
  const absPath = resolveWithinWorkspace(root, relPath);
  const [content, fileStat] = await Promise.all([
    readFile(absPath, "utf-8"),
    stat(absPath),
  ]);
  return {
    content,
    mtime: fileStat.mtime.toISOString(),
    size: fileStat.size,
  };
}

/**
 * Write a file within the workspace using atomic temp → rename pattern.
 * Optionally checks mtime for conflict detection.
 */
export async function writeWorkspaceFile(
  root: string,
  relPath: string,
  content: string,
  expectedMtime?: string,
): Promise<{ mtime: string; size: number }> {
  const absPath = resolveWithinWorkspace(root, relPath);

  // Conflict detection: if expectedMtime is provided, check current mtime
  if (expectedMtime) {
    try {
      const currentStat = await stat(absPath);
      if (currentStat.mtime.toISOString() !== expectedMtime) {
        throw new WorkspaceSecurityError(
          `File was modified since last read (expected mtime ${expectedMtime}, got ${currentStat.mtime.toISOString()})`,
        );
      }
    } catch (e) {
      if (e instanceof WorkspaceSecurityError) throw e;
      // File doesn't exist yet — that's fine for new files
    }
  }

  // Ensure parent directory exists
  const parentDir = resolve(absPath, "..");
  await mkdir(parentDir, { recursive: true });

  // Atomic write: write to temp file, then rename
  const tempPath = absPath + `.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, absPath);

  const newStat = await stat(absPath);
  return {
    mtime: newStat.mtime.toISOString(),
    size: newStat.size,
  };
}

/**
 * Create a directory within the workspace.
 */
export async function mkdirWorkspace(
  root: string,
  relPath: string,
): Promise<void> {
  const absPath = resolveWithinWorkspace(root, relPath);
  await mkdir(absPath, { recursive: true });
}

/**
 * Rename/move a file or directory within the workspace.
 */
export async function renameWorkspace(
  root: string,
  fromRelPath: string,
  toRelPath: string,
): Promise<void> {
  const absFrom = resolveWithinWorkspace(root, fromRelPath);
  const absTo = resolveWithinWorkspace(root, toRelPath);

  // Ensure target parent exists
  const parentDir = resolve(absTo, "..");
  await mkdir(parentDir, { recursive: true });

  await rename(absFrom, absTo);
}

/**
 * Delete a file within the workspace.
 */
export async function deleteWorkspace(
  root: string,
  relPath: string,
): Promise<void> {
  const absPath = resolveWithinWorkspace(root, relPath);
  await unlink(absPath);
}

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

export interface SearchResult {
  readonly path: string;       // relative to workspace root
  readonly line: number;
  readonly content: string;    // matching line
  readonly storyRole?: string;
}

/**
 * Simple grep-like search across workspace text files.
 */
export async function searchWorkspace(
  root: string,
  query: string,
  options?: {
    readonly scope?: "all" | "chapters" | "truth" | "state";
    readonly maxResults?: number;
  },
): Promise<readonly SearchResult[]> {
  const maxResults = options?.maxResults ?? 100;
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  await searchDir(root, root, "", lowerQuery, options?.scope ?? "all", results, maxResults);
  return results;
}

async function searchDir(
  workspaceRoot: string,
  absDir: string,
  relDir: string,
  lowerQuery: string,
  scope: string,
  results: SearchResult[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Scope filtering at directory level
      if (scope === "chapters" && !relPath.includes("chapters") && !relPath.startsWith("books")) continue;
      if (scope === "truth" && !relPath.includes("story") && !relPath.startsWith("books")) continue;

      await searchDir(workspaceRoot, join(absDir, entry.name), relPath, lowerQuery, scope, results, maxResults);
    } else if (entry.isFile() && isSearchableFile(entry.name)) {
      // Scope filtering at file level
      const role = inferFileRole(relPath, entry.name);
      if (scope === "chapters" && role !== "chapter") continue;
      if (scope === "truth" && role !== "truth") continue;
      if (scope === "state" && !relPath.includes("state")) continue;

      try {
        const content = await readFile(join(absDir, entry.name), "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) return;
          if (lines[i]!.toLowerCase().includes(lowerQuery)) {
            results.push({
              path: relPath,
              line: i + 1,
              content: lines[i]!.trim().slice(0, 200),
              storyRole: role,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

function isSearchableFile(name: string): boolean {
  return name.endsWith(".md") || name.endsWith(".json") || name.endsWith(".txt") || name.endsWith(".yaml") || name.endsWith(".yml");
}
