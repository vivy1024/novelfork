/**
 * 书籍独立 Git 仓库自动提交记录（章节入库 / 改稿 / 工作流落盘留痕）。
 *
 * 安全边界：
 * 1. 只在书根自身就是独立 Git 仓库顶层（realpath(show-toplevel) === realpath(bookRoot)）时提交，
 *    绝不向外部父仓库或宿主项目仓库误提交；
 * 2. 清除 GIT_DIR / GIT_COMMON_DIR / GIT_WORK_TREE / GIT_INDEX_FILE 并禁用终端提示，避免串库或阻塞；
 * 3. 只暂存本次章节入库明确涉及的相对路径（目标章文件 + chapters/index.json），绝不 git add -A；
 * 4. 任何 git 不可用 / 非独立仓库 / 无变更 / 提交失败都不影响已落盘的正文，如实返回状态给调用方。
 */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BOOK_GIT_COMMIT_TIMEOUT_MS = 10_000;

const FALLBACK_GIT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "NovelFork",
  GIT_AUTHOR_EMAIL: "novelfork@novelfork.local",
  GIT_COMMITTER_NAME: "NovelFork",
  GIT_COMMITTER_EMAIL: "novelfork@novelfork.local",
};

export interface AutoCommitBookChapterInput {
  readonly bookRoot: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount?: number;
  readonly mode: "new" | "revision";
  readonly fromWorkflowRun?: boolean;
  /** 相对于书根的路径列表（如 chapters/卷01/0001_开篇.md、chapters/index.json）。 */
  readonly relativePaths: readonly string[];
}

export interface AutoCommitBookChapterResult {
  readonly ok: boolean;
  readonly status: "committed" | "skipped" | "failed";
  readonly commitSha?: string;
  readonly commitMessage?: string;
  readonly reason?: string;
}

function buildGitEnv(identity?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...identity, GIT_TERMINAL_PROMPT: "0" };
  delete env.GIT_DIR;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

async function runGit(
  bookRoot: string,
  args: readonly string[],
  identity?: Readonly<Record<string, string>>,
): Promise<{ readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly detail: string }> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", bookRoot, ...args], {
      env: buildGitEnv(identity),
      timeout: BOOK_GIT_COMMIT_TIMEOUT_MS,
      windowsHide: true,
    });
    return { ok: true, stdout: String(stdout ?? "").trim() };
  } catch (error) {
    const err = error as { stderr?: unknown; stdout?: unknown; message?: unknown; code?: unknown };
    const detail = String(err.stderr || err.stdout || err.message || err.code || "git 执行失败").trim();
    return { ok: false, detail };
  }
}

async function isDedicatedBookGitRepo(bookRoot: string): Promise<boolean> {
  const top = await runGit(bookRoot, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout) return false;
  const [resolvedTop, resolvedRoot] = await Promise.all([
    realpath(top.stdout).catch(() => null),
    realpath(bookRoot).catch(() => null),
  ]);
  return Boolean(resolvedTop && resolvedRoot && resolvedTop === resolvedRoot);
}

function sanitizeBookRelativePaths(bookRoot: string, paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim().replaceAll("\\", "/").replace(/^\/+/u, "");
    if (!trimmed) continue;
    const abs = resolve(bookRoot, trimmed);
    const rel = relative(bookRoot, abs).replaceAll("\\", "/");
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    result.push(rel);
  }
  return result;
}

function buildCommitMessage(input: AutoCommitBookChapterInput): string {
  const padNum = String(input.chapterNumber).padStart(4, "0");
  const cleanTitle = input.title.replace(/[\r\n]+/gu, " ").trim() || `第${input.chapterNumber}章`;
  const wordsSuffix = typeof input.wordCount === "number" && input.wordCount > 0 ? `（${input.wordCount}字）` : "";
  if (input.mode === "revision") {
    return `fix(ch${padNum}): 修订第${input.chapterNumber}章「${cleanTitle}」${wordsSuffix}`;
  }
  const actionLabel = input.fromWorkflowRun ? "工作流入库" : "入库";
  return `feat(ch${padNum}): ${actionLabel}第${input.chapterNumber}章「${cleanTitle}」${wordsSuffix}`;
}

/**
 * 在章节正式入库后自动在书根独立 Git 仓库中创建一条章节提交记录。
 */
export async function autoCommitBookChapter(
  input: AutoCommitBookChapterInput,
): Promise<AutoCommitBookChapterResult> {
  const bookRoot = input.bookRoot.trim();
  if (!bookRoot) {
    return { ok: true, status: "skipped", reason: "book-root-empty" };
  }
  const dedicated = await isDedicatedBookGitRepo(bookRoot);
  if (!dedicated) {
    return { ok: true, status: "skipped", reason: "not-a-dedicated-book-git-repo" };
  }

  const stagePaths = sanitizeBookRelativePaths(bookRoot, input.relativePaths);
  if (stagePaths.length === 0) {
    return { ok: true, status: "skipped", reason: "no-paths-to-stage" };
  }

  const staged = await runGit(bookRoot, ["add", "--", ...stagePaths]);
  if (!staged.ok) {
    return { ok: false, status: "failed", reason: `git add 失败：${staged.detail}` };
  }

  // 若指定文件相比 HEAD 无变化则不产生空提交
  const diffCheck = await runGit(bookRoot, ["diff", "--cached", "--quiet", "--", ...stagePaths]);
  if (diffCheck.ok) {
    return { ok: true, status: "skipped", reason: "no-changes" };
  }

  const message = buildCommitMessage(input);
  const commitArgs = ["commit", "--no-gpg-sign", "--no-verify", "-m", message, "--", ...stagePaths];
  let committed = await runGit(bookRoot, commitArgs);
  if (!committed.ok) {
    committed = await runGit(bookRoot, commitArgs, FALLBACK_GIT_IDENTITY);
  }
  if (!committed.ok) {
    return { ok: false, status: "failed", commitMessage: message, reason: committed.detail };
  }

  const rev = await runGit(bookRoot, ["rev-parse", "--short", "HEAD"]);
  return {
    ok: true,
    status: "committed",
    ...(rev.ok && rev.stdout ? { commitSha: rev.stdout } : {}),
    commitMessage: message,
  };
}
