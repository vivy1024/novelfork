import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGenreProfile, type ParsedGenreProfile } from "@vivy1024/novelfork-core";
// 走窄入口：core barrel 含 node 专属模块（config-loader 用 os.homedir），
// 从 barrel 导入会把它拉进 Studio 的浏览器构建并导致 rollup 解析失败。
import { BUNDLED_GENRE_PROFILES } from "@vivy1024/novelfork-core/models/genre-profiles";
import { parseBookRules, type ParsedBookRules } from "@vivy1024/novelfork-core";
import { z } from "zod";

function resolveBuiltinGenresDir(): string {
  try {
    const coreEntry = fileURLToPath(import.meta.resolve("@vivy1024/novelfork-core"));
    return join(dirname(coreEntry), "../genres");
  } catch {
    const moduleDir = typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    return join(moduleDir, "../../../../core/genres");
  }
}

const BUILTIN_GENRES_DIR = resolveBuiltinGenresDir();

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** 唯一 fallback 题材 id；所有来源都命不中时用它兜底。 */
const FALLBACK_GENRE_ID = "other";

/**
 * 内嵌快照：编译成 EXE 后 `BUILTIN_GENRES_DIR` 指向的源码树已不存在，
 * 磁盘查找必然全部落空。此处按 id 命中随包分发的 profile 正文。
 */
function readBundledGenreProfile(genreId: string): string | null {
  return BUNDLED_GENRE_PROFILES.find((entry) => entry.id === genreId)?.content ?? null;
}

/**
 * Load genre profile. Lookup order:
 * 1. Project-level: {projectRoot}/genres/{genreId}.md
 * 2. Built-in disk: packages/core/genres/{genreId}.md（开发态覆盖内嵌快照）
 * 3. Bundled:       内嵌快照中的同名题材（编译态唯一来源）
 * 4. Fallback disk: built-in other.md
 * 5. Fallback bundled: 内嵌快照中的 other
 */
export async function readGenreProfile(
  projectRoot: string,
  genreId: string,
): Promise<ParsedGenreProfile> {
  const projectPath = join(projectRoot, "genres", `${genreId}.md`);
  const builtinPath = join(BUILTIN_GENRES_DIR, `${genreId}.md`);
  const fallbackPath = join(BUILTIN_GENRES_DIR, `${FALLBACK_GENRE_ID}.md`);

  const raw =
    (await tryReadFile(projectPath)) ??
    (await tryReadFile(builtinPath)) ??
    readBundledGenreProfile(genreId) ??
    (await tryReadFile(fallbackPath)) ??
    readBundledGenreProfile(FALLBACK_GENRE_ID);

  if (!raw) {
    throw new Error(
      `题材定义缺失：找不到「${genreId}」，且内置 fallback「${FALLBACK_GENRE_ID}」也不可用。`
      + `已查找：书籍级 ${projectPath}、内置目录 ${BUILTIN_GENRES_DIR}、随包内嵌快照。`
      + `可在书籍目录下新建 genres/${genreId}.md（带 name/id/chapterTypes/fatigueWords 等 frontmatter）作为该书专用题材定义。`,
    );
  }

  return parseGenreProfile(raw);
}

/**
 * List all available genre profiles (project-level + built-in, deduped).
 * Returns array of { id, name, source }.
 */
export async function listAvailableGenres(
  projectRoot: string,
): Promise<ReadonlyArray<{ readonly id: string; readonly name: string; readonly source: "project" | "builtin" }>> {
  const results = new Map<string, { id: string; name: string; source: "project" | "builtin" }>();

  // 内嵌快照垫底：编译态没有磁盘目录，否则这里会返回空列表。
  for (const entry of BUNDLED_GENRE_PROFILES) {
    try {
      const parsed = parseGenreProfile(entry.content);
      results.set(entry.id, { id: entry.id, name: parsed.profile.name, source: "builtin" });
    } catch { /* 生成期已校验，运行期忽略坏条目 */ }
  }

  // Built-in genres on disk override the bundled snapshot (dev tree wins)
  try {
    const builtinFiles = await readdir(BUILTIN_GENRES_DIR);
    for (const file of builtinFiles) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(/\.md$/, "");
      const raw = await tryReadFile(join(BUILTIN_GENRES_DIR, file));
      if (!raw) continue;
      const parsed = parseGenreProfile(raw);
      results.set(id, { id, name: parsed.profile.name, source: "builtin" });
    }
  } catch { /* no builtin dir */ }

  // Project-level genres override
  const projectDir = join(projectRoot, "genres");
  try {
    const projectFiles = await readdir(projectDir);
    for (const file of projectFiles) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(/\.md$/, "");
      const raw = await tryReadFile(join(projectDir, file));
      if (!raw) continue;
      const parsed = parseGenreProfile(raw);
      results.set(id, { id, name: parsed.profile.name, source: "project" });
    }
  } catch { /* no project genres dir */ }

  return [...results.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Return the path to the built-in genres directory. */
export function getBuiltinGenresDir(): string {
  return BUILTIN_GENRES_DIR;
}

/**
 * Load book_rules.md from the book's story directory.
 * Returns null if the file doesn't exist.
 */
export async function readBookRules(bookDir: string): Promise<ParsedBookRules | null> {
  const raw = await tryReadFile(join(bookDir, "story/book_rules.md"));
  if (!raw) return null;
  return parseBookRules(raw);
}

export async function readBookLanguage(bookDir: string): Promise<"zh" | "en" | undefined> {
  const raw = await tryReadFile(join(bookDir, "book.json"));
  if (!raw) return undefined;

  try {
    // BookConfigSchema 带 preprocess（旧字段归一），不是可 .pick 的 ZodObject；
    // 这里只需要 language 一个字段，单独校验即可。
    const parsed = z.object({ language: z.enum(["zh", "en"]).optional() })
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.language : undefined;
  } catch {
    return undefined;
  }
}
