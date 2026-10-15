import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	chapters,
	db as runtimeDb,
	generateId,
	getDbDir,
	logger,
	narrators,
	projects,
	type RuntimeResolveContext,
	users,
	ValidationError,
} from "@vivy1024/narrafork-runtime-bridge";
import { and, eq, ne } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { getNovelForkProductDatabase } from "../db/database";
import { bookRuntimeBindings } from "../db/schema";

export interface BookRuntimeBindingRecord {
	id: string;
	runtimeProjectId: string;
	bookId: string;
	bookRoot: string;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BookRuntimeBindingStore {
	findByProjectId(runtimeProjectId: string): Promise<BookRuntimeBindingRecord | null>;
	/** Optional for legacy test/adapter stores; production Drizzle store implements it. */
	findByBookId?(bookId: string): Promise<BookRuntimeBindingRecord | null>;
	findByNarratorId(narratorId: string): Promise<BookRuntimeBindingRecord | null>;
	projectExists(runtimeProjectId: string): Promise<boolean>;
	bookBoundElsewhere(bookId: string, runtimeProjectId: string): Promise<boolean>;
	upsert(record: BookRuntimeBindingRecord): Promise<BookRuntimeBindingRecord>;
	deleteByProjectId(runtimeProjectId: string): Promise<boolean>;
}

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Server-written marker required before a persisted external root is trusted. */
export const EXTERNAL_BOOK_WORKSPACE_MARKER = "novelforkExternalWorkspace";

async function isMarkedExternalBookRoot(bookRoot: string, bookId: string): Promise<boolean> {
	const raw = await readFile(join(bookRoot, "book.json"), "utf8").catch(() => null);
	if (!raw) return false;
	try {
		const config: unknown = JSON.parse(raw);
		return (
			Boolean(config) &&
			typeof config === "object" &&
			!Array.isArray(config) &&
			(config as Record<string, unknown>).id === bookId &&
			(config as Record<string, unknown>)[EXTERNAL_BOOK_WORKSPACE_MARKER] === true
		);
	} catch {
		return false;
	}
}

export function deriveBookRoot(booksRoot: string, bookId: string): string {
	const normalizedId = bookId.trim();
	if (!normalizedId) throw new ValidationError("bookId must not be empty");
	if (isAbsolute(normalizedId)) throw new ValidationError("bookId must be relative");
	if (
		normalizedId === "." ||
		normalizedId === ".." ||
		normalizedId.includes("/") ||
		normalizedId.includes("\\")
	) {
		throw new ValidationError("bookId must be a single path segment");
	}
	const canonicalRoot = resolve(booksRoot);
	const bookRoot = resolve(canonicalRoot, normalizedId);
	if (!isContained(canonicalRoot, bookRoot) || bookRoot === canonicalRoot) {
		throw new ValidationError("bookRoot must remain inside booksRoot");
	}
	return bookRoot;
}

export async function resolveTrustedBookRoot(
	binding: BookRuntimeBindingRecord,
	booksRoot: string,
	allowExternalRoot = false,
): Promise<string | null> {
	const diagnosis = await diagnoseTrustedBookRoot(binding, booksRoot, allowExternalRoot);
	return diagnosis.reason === "trusted" ? diagnosis.bookRoot : null;
}

/**
 * Why a persisted binding is (not) trusted.
 *
 * `resolveTrustedBookRoot` deliberately collapses every failure into `null`,
 * which used to make a broken binding indistinguishable from "no binding at
 * all". That silence is what let a book narrator lose every novel domain tool
 * with no explanation: the model kept being told to maintain Jingwei while
 * `lore.write` had already been filtered out, so it fell back to rewriting
 * local files. Callers that surface diagnostics must use this function instead.
 */
export type TrustedBookRootDiagnosis =
	| { readonly reason: "trusted"; readonly bookRoot: string }
	| {
			readonly reason:
				| "empty-book-id"
				| "relative-book-root"
				| "book-root-missing"
				| "book-root-not-directory"
				| "external-root-unmarked";
			readonly bookRoot: null;
	  };

export async function diagnoseTrustedBookRoot(
	binding: BookRuntimeBindingRecord,
	booksRoot: string,
	allowExternalRoot = false,
): Promise<TrustedBookRootDiagnosis> {
	if (!binding.bookId.trim()) return { reason: "empty-book-id", bookRoot: null };
	if (!isAbsolute(binding.bookRoot)) return { reason: "relative-book-root", bookRoot: null };
	try {
		const canonicalBooksRoot = await realpath(resolve(booksRoot));
		const expectedBookRoot = deriveBookRoot(canonicalBooksRoot, binding.bookId);
		const [canonicalBookRoot, expectedCanonicalRoot, bookInfo] = await Promise.all([
			realpath(binding.bookRoot),
			realpath(expectedBookRoot).catch(() => null),
			stat(binding.bookRoot),
		]);
		if (!bookInfo.isDirectory()) return { reason: "book-root-not-directory", bookRoot: null };
		const isControlledRoot =
			canonicalBookRoot === expectedCanonicalRoot &&
			isContained(canonicalBooksRoot, canonicalBookRoot);
		if (isControlledRoot) return { reason: "trusted", bookRoot: canonicalBookRoot };
		if (!allowExternalRoot) return { reason: "external-root-unmarked", bookRoot: null };
		return (await isMarkedExternalBookRoot(canonicalBookRoot, binding.bookId))
			? { reason: "trusted", bookRoot: canonicalBookRoot }
			: { reason: "external-root-unmarked", bookRoot: null };
	} catch {
		// realpath/stat failure means the recorded root no longer resolves on disk.
		return { reason: "book-root-missing", bookRoot: null };
	}
}

/** Author-facing explanation: what happened / why it matters / what to do. */
export function explainTrustedBookRootFailure(
	reason: Exclude<TrustedBookRootDiagnosis["reason"], "trusted">,
	binding: Pick<BookRuntimeBindingRecord, "bookId" | "bookRoot">,
): string {
	const where = `书籍 ${binding.bookId}（记录根目录：${binding.bookRoot}）`;
	switch (reason) {
		case "empty-book-id":
			return `${where} 的绑定记录缺少 bookId，服务端无法解析可信书籍上下文，因此本会话不会加载任何小说领域工具。请在书籍设置中重新绑定该书。`;
		case "relative-book-root":
			return `${where} 的绑定记录保存的是相对路径，可信根解析要求绝对路径，因此本会话不会加载任何小说领域工具。请重新绑定该书以写入规范化的绝对路径。`;
		case "book-root-missing":
			return `${where} 的目录当前无法访问（可能已被移动、重命名或所在磁盘未挂载），因此本会话不会加载任何小说领域工具。请把目录恢复到记录路径，或重新绑定到新位置。`;
		case "book-root-not-directory":
			return `${where} 的记录路径存在但不是目录，因此本会话不会加载任何小说领域工具。请检查该路径并重新绑定该书。`;
		case "external-root-unmarked":
			return `${where} 位于受控 books 根之外，且其 book.json 缺少服务端写入的可信标记（${EXTERNAL_BOOK_WORKSPACE_MARKER}=true 且 id 与 bookId 一致），因此本会话不会加载任何小说领域工具。请在产品内重新绑定该外部书籍目录，由服务端补写标记。`;
	}
}

async function resolveTrustedContext(
	binding: BookRuntimeBindingRecord,
	booksRoot: string,
	allowExternalRoot = false,
): Promise<RuntimeResolveContext | null> {
	const canonicalBookRoot = await resolveTrustedBookRoot(binding, booksRoot, allowExternalRoot);
	if (!canonicalBookRoot) return null;
	const canonicalBooksRoot = await realpath(resolve(booksRoot)).catch(() => null);
	if (!canonicalBooksRoot) return null;
	const resourceBinding = Object.freeze({
		kind: "novel.book",
		bookId: binding.bookId,
		root: canonicalBookRoot,
	});
	return Object.freeze({
		runtimeProjectId: binding.runtimeProjectId,
		projectRoot: canonicalBooksRoot,
		projectType: "novel",
		enabledPluginIds: Object.freeze(["novelfork-novel"]),
		resourceBindings: Object.freeze({ "novel.book": resourceBinding }),
	});
}

export class BookRuntimeBindingService {
	constructor(
		private readonly store: BookRuntimeBindingStore,
		private readonly booksRoot: string,
	) {}

	getByProjectId(runtimeProjectId: string): Promise<BookRuntimeBindingRecord | null> {
		return this.store.findByProjectId(runtimeProjectId);
	}

	getByBookId(bookId: string): Promise<BookRuntimeBindingRecord | null> {
		return this.store.findByBookId?.(bookId) ?? Promise.resolve(null);
	}

	getByNarratorId(narratorId: string): Promise<BookRuntimeBindingRecord | null> {
		return this.store.findByNarratorId(narratorId);
	}

	/**
	 * Why this narrator has (or lacks) a trusted book context.
	 *
	 * `resolveForNarrator` returns `null` both when a narrator is simply not
	 * bound to a book and when a real binding failed its trust check. Only the
	 * second case is a defect the author must fix, and it is the one that
	 * silently strips every novel domain tool from a book narrator. Callers that
	 * report diagnostics must use this instead of interpreting a bare `null`.
	 */
	async diagnoseForNarrator(narratorId: string): Promise<
		| { readonly status: "unbound" }
		| { readonly status: "trusted"; readonly binding: BookRuntimeBindingRecord }
		| {
				readonly status: "untrusted";
				readonly binding: BookRuntimeBindingRecord;
				readonly reason: Exclude<TrustedBookRootDiagnosis["reason"], "trusted">;
				readonly explanation: string;
		  }
	> {
		if (!narratorId.trim()) return { status: "unbound" };
		const binding = await this.store.findByNarratorId(narratorId);
		if (!binding) return { status: "unbound" };
		const diagnosis = await diagnoseTrustedBookRoot(binding, this.booksRoot, true);
		if (diagnosis.reason === "trusted") return { status: "trusted", binding };
		return {
			status: "untrusted",
			binding,
			reason: diagnosis.reason,
			explanation: explainTrustedBookRootFailure(diagnosis.reason, binding),
		};
	}

	async resolveForNarrator(narratorId: string): Promise<RuntimeResolveContext | null> {
		if (!narratorId.trim()) return null;
		const binding = await this.store.findByNarratorId(narratorId);
		// An external root remains fail-closed unless its server-created book manifest
		// proves it belongs to this exact binding.
		return binding ? resolveTrustedContext(binding, this.booksRoot, true) : null;
	}

	async upsert(
		runtimeProjectId: string,
		bookId: string,
		createdByUserId: string | null,
		bookRootOverride?: string,
	): Promise<BookRuntimeBindingRecord> {
		if (!runtimeProjectId.trim()) throw new ValidationError("projectId must not be empty");
		if (!(await this.store.projectExists(runtimeProjectId))) {
			throw new ValidationError(`Project not found: ${runtimeProjectId}`);
		}
		const normalizedBookId = bookId.trim();
		const canonicalBooksRoot = await realpath(resolve(this.booksRoot)).catch(() => {
			throw new ValidationError("Controlled books root is not accessible");
		});
		const derivedBookRoot = deriveBookRoot(canonicalBooksRoot, normalizedBookId);
		const requestedRoot = bookRootOverride?.trim() || derivedBookRoot;
		const bookRoot = await realpath(requestedRoot).catch(() => {
			throw new ValidationError(`Book not found: ${normalizedBookId}`);
		});
		const bookInfo = await stat(bookRoot).catch(() => null);
		if (!bookInfo?.isDirectory() || (!bookRootOverride && !isContained(canonicalBooksRoot, bookRoot))) {
			throw new ValidationError(
				"Book root must be an existing directory inside the controlled books root",
			);
		}
		if (await this.store.bookBoundElsewhere(normalizedBookId, runtimeProjectId)) {
			throw new ValidationError("Book is already bound to another runtime project");
		}
		const existing = await this.store.findByProjectId(runtimeProjectId);
		const now = new Date().toISOString();
		return this.store.upsert({
			id: existing?.id ?? generateId(),
			runtimeProjectId,
			bookId: normalizedBookId,
			bookRoot,
			createdByUserId: existing?.createdByUserId ?? createdByUserId,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		});
	}

	deleteByProjectId(runtimeProjectId: string): Promise<boolean> {
		return this.store.deleteByProjectId(runtimeProjectId);
	}
}

export const drizzleBookRuntimeBindingStore: BookRuntimeBindingStore = {
	async findByProjectId(runtimeProjectId) {
		const productDb = getNovelForkProductDatabase();
		return (
			(await productDb.query.bookRuntimeBindings.findFirst({
				where: eq(bookRuntimeBindings.runtimeProjectId, runtimeProjectId),
			})) ?? null
		);
	},
	async findByBookId(bookId) {
		const productDb = getNovelForkProductDatabase();
		return (
			(await productDb.query.bookRuntimeBindings.findFirst({
				where: eq(bookRuntimeBindings.bookId, bookId),
			})) ?? null
		);
	},
	async findByNarratorId(narratorId) {
		const [row] = await runtimeDb
			.select({ runtimeProjectId: projects.id })
			.from(narrators)
			.innerJoin(chapters, eq(narrators.chapterId, chapters.id))
			.innerJoin(projects, eq(chapters.projectId, projects.id))
			.where(eq(narrators.id, narratorId))
			.limit(1);
		if (!row) return null;
		return this.findByProjectId(row.runtimeProjectId);
	},
	async projectExists(runtimeProjectId) {
		return Boolean(
			await runtimeDb.query.projects.findFirst({
				where: eq(projects.id, runtimeProjectId),
				columns: { id: true },
			}),
		);
	},
	async bookBoundElsewhere(bookId, runtimeProjectId) {
		const productDb = getNovelForkProductDatabase();
		return Boolean(
			await productDb.query.bookRuntimeBindings.findFirst({
				where: and(
					eq(bookRuntimeBindings.bookId, bookId),
					ne(bookRuntimeBindings.runtimeProjectId, runtimeProjectId),
				),
				columns: { id: true },
			}),
		);
	},
	async upsert(record) {
		const productDb = getNovelForkProductDatabase();
		const [saved] = await productDb
			.insert(bookRuntimeBindings)
			.values(record)
			.onConflictDoUpdate({
				target: bookRuntimeBindings.runtimeProjectId,
				set: { bookId: record.bookId, bookRoot: record.bookRoot, updatedAt: record.updatedAt },
			})
			.returning();
		return saved;
	},
	async deleteByProjectId(runtimeProjectId) {
		const productDb = getNovelForkProductDatabase();
		const deleted = await productDb
			.delete(bookRuntimeBindings)
			.where(eq(bookRuntimeBindings.runtimeProjectId, runtimeProjectId))
			.returning({ id: bookRuntimeBindings.id });
		return deleted.length > 0;
	},
};

export function getControlledBooksRoot(): string {
	const configuredRoot =
		process.env.NOVELFORK_BOOKS_ROOT ??
		process.env.NARRAFORK_BOOKS_ROOT ??
		(process.env.NOVELFORK_PROJECT_ROOT
			? resolve(process.env.NOVELFORK_PROJECT_ROOT, "books")
			: resolve(getDbDir(), "books"));
	return resolve(configuredRoot);
}

export const bookRuntimeBindingService = new BookRuntimeBindingService(
	drizzleBookRuntimeBindingStore,
	getControlledBooksRoot(),
);

// ---------------------------------------------------------------------------
// 书根的 git 仓库
//
// NarraFork 的模型是「项目就是 git 仓库」：Runtime 删除项目前会在 gitPath 上执行
// `git rev-parse --git-common-dir` 核实资源保护，失败就拒绝删除（409）。NovelFork 建书时
// 直接往 Runtime 写项目行、gitPath = 书根，所以受控目录必须真的是仓库，删书才走得通。
// Bridge 没有导出 Runtime 的 gitService / ensureGitignoreEntry，这里按同等行为实现。
// ---------------------------------------------------------------------------

/** 单条 git 命令的上限：建书与删书都在请求里调用，宁可超时降级也不能把请求卡死。 */
const BOOK_GIT_TIMEOUT_MS = 15_000;

/** 与 Runtime 的 ensureGitignoreEntry 同一份清单：Runtime 在项目根下的私有目录不进版本库。 */
const RUNTIME_GITIGNORE_ENTRIES = [".narrafork/", ".worktrees/"] as const;

/**
 * 创建者与本机都没有可用的提交身份时，建书初始化提交改用的产品身份。
 * 这两笔是建书的整理提交（空的初始提交 + .gitignore），不含作者正文，
 * 与 Runtime 快照提交使用固定身份同理。
 */
const BOOK_GIT_FALLBACK_IDENTITY: Readonly<Record<string, string>> = {
	GIT_AUTHOR_NAME: "NovelFork",
	GIT_AUTHOR_EMAIL: "novelfork@novelfork.local",
	GIT_COMMITTER_NAME: "NovelFork",
	GIT_COMMITTER_EMAIL: "novelfork@novelfork.local",
};

export type BookGitFailureReason = "git-unavailable" | "timeout" | "failed";

export type BookGitResult =
	| { readonly ok: true; readonly stdout: string }
	| { readonly ok: false; readonly reason: BookGitFailureReason; readonly detail: string };

function spawnBookGit(args: readonly string[], identity?: Readonly<Record<string, string>>) {
	const env: Record<string, string | undefined> = { ...process.env, ...identity, GIT_TERMINAL_PROMPT: "0" };
	// 与 Runtime 的 lifecycleGitProbeEnv 一致：继承来的这些变量会把命令带到别的仓库。
	for (const name of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
	return Bun.spawn(["git", ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

/** 调一次 git（参数里用 -C 指定目录，不依赖 cwd），带超时；找不到 git 时不抛异常。 */
async function runBookGit(
	args: readonly string[],
	identity?: Readonly<Record<string, string>>,
): Promise<BookGitResult> {
	let proc: ReturnType<typeof spawnBookGit>;
	try {
		proc = spawnBookGit(args, identity);
	} catch (error) {
		return { ok: false, reason: "git-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, BOOK_GIT_TIMEOUT_MS);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (timedOut) {
			return { ok: false, reason: "timeout", detail: `git ${args.join(" ")} 超过 ${BOOK_GIT_TIMEOUT_MS / 1000} 秒没有结束` };
		}
		if (exitCode !== 0) {
			return { ok: false, reason: "failed", detail: stderr.trim() || stdout.trim() || `git 退出码 ${exitCode}` };
		}
		return { ok: true, stdout: stdout.trim() };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 与 Runtime 删除项目前的核实是同一条命令（worktree-lifecycle-guard 的 withProjectRetirement）。
 * 这里能过，Runtime 那一步就能过。
 */
export function probeRuntimeProjectGitPath(gitPath: string): Promise<BookGitResult> {
	return runBookGit(["--no-optional-locks", "-C", gitPath, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
}

/** 书根自己是不是仓库的顶层。借用上级目录的仓库不算：那样 Runtime 的 git 操作会落到别人的仓库里。 */
async function isBookGitTopLevel(root: string): Promise<boolean> {
	const result = await runBookGit(["-C", root, "rev-parse", "--show-toplevel"]);
	if (!result.ok || !result.stdout) return false;
	const [topLevel, self] = await Promise.all([
		realpath(result.stdout).catch(() => null),
		realpath(root).catch(() => null),
	]);
	return Boolean(topLevel && self && topLevel === self);
}

/**
 * 与 Runtime 建项目同一口径的提交身份：项目创建者在 Runtime 里配置的 git 用户名与邮箱；
 * 没配置时返回 null，继承本机 git 配置。
 */
async function resolveCreatorGitIdentity(userId: string | null | undefined): Promise<Record<string, string> | null> {
	if (!userId) return null;
	try {
		const row = await runtimeDb.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { gitUsername: true, gitEmail: true },
		});
		const name = row?.gitUsername?.trim();
		const email = row?.gitEmail?.trim();
		if (!name || !email || /[<>\r\n]/u.test(`${name}${email}`)) return null;
		return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
	} catch {
		return null;
	}
}

/** 建书的整理提交：先用创建者身份（或本机配置），被拒时改用产品身份再试一次。不签名，免得弹出口令窗口。 */
async function commitBookSetup(
	root: string,
	args: readonly string[],
	identity: Record<string, string> | null,
): Promise<BookGitResult> {
	const command = ["-C", root, "-c", "commit.gpgsign=false", "commit", ...args];
	const first = await runBookGit(command, identity ?? undefined);
	if (first.ok || first.reason !== "failed") return first;
	return runBookGit(command, BOOK_GIT_FALLBACK_IDENTITY);
}

/** 与 Runtime 的 ensureGitignoreEntry 相同：缺哪条补哪条，已有内容原样保留。 */
async function ensureRuntimeGitignoreEntries(root: string): Promise<void> {
	const path = join(root, ".gitignore");
	const content = await readFile(path, "utf8").catch(() => null);
	if (content === null) {
		await writeFile(path, `${RUNTIME_GITIGNORE_ENTRIES.join("\n")}\n`, "utf8");
		return;
	}
	const missing = RUNTIME_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
	if (missing.length > 0) await writeFile(path, `${content.trimEnd()}\n${missing.join("\n")}\n`, "utf8");
}

export type BookGitRepositoryResult =
	| { readonly status: "existing" | "initialized" }
	| { readonly status: "failed"; readonly reason: BookGitFailureReason; readonly detail: string };

/**
 * 把受控书根初始化为 git 仓库，口径照 NarraFork 建项目的 init 模式：
 * `git init` → 空的「Initial commit」→ 写入 .gitignore（.narrafork/、.worktrees/）并提交「Add .gitignore」。
 * 书的正文与设定不进提交，与 NarraFork 在已有目录上 init 一致。
 *
 * 与 NarraFork 的差别：
 * - 默认分支固定为 main（不跟随本机 init.defaultBranch），与产品写入 Runtime 的 defaultBranch / 根章节 branch 一致；
 * - 提交失败不算失败：仓库已经建好，删书所需的核实已经能通过，只记 warn。
 *
 * 只能用于 NovelFork 自己管理的目录，绝不能对用户的外部目录调用。已是仓库顶层时什么都不做。
 */
export async function ensureBookGitRepository(
	root: string,
	options: { readonly creatorUserId?: string | null } = {},
): Promise<BookGitRepositoryResult> {
	if (await isBookGitTopLevel(root)) return { status: "existing" };
	const init = await runBookGit(["-C", root, "init", "-q"]);
	if (!init.ok) return { status: "failed", reason: init.reason, detail: init.detail };
	if (!(await isBookGitTopLevel(root))) {
		return {
			status: "failed",
			reason: "failed",
			detail: "git init 之后书根仍不是仓库顶层（可能被 safe.directory 等 git 配置拒绝）",
		};
	}
	const identity = await resolveCreatorGitIdentity(options.creatorUserId);
	const problems: string[] = [];
	// 只给全新的仓库定分支、做初始提交；git init 重新初始化已有的 .git 时不动它的 HEAD。
	if (!(await runBookGit(["-C", root, "rev-parse", "--verify", "-q", "HEAD"])).ok) {
		const branch = await runBookGit(["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"]);
		if (!branch.ok) problems.push(`设置默认分支 main 失败：${branch.detail}`);
		const initial = await commitBookSetup(root, ["--allow-empty", "-m", "Initial commit"], identity);
		if (!initial.ok) problems.push(`初始提交失败：${initial.detail}`);
	}
	try {
		await ensureRuntimeGitignoreEntries(root);
		const status = await runBookGit(["-C", root, "status", "--porcelain", "--", ".gitignore"]);
		if (status.ok && status.stdout) {
			const add = await runBookGit(["-C", root, "add", "--", ".gitignore"]);
			const commit = add.ok
				? await commitBookSetup(root, ["-m", "Add .gitignore", "--", ".gitignore"], identity)
				: add;
			if (!commit.ok) problems.push(`提交 .gitignore 失败：${commit.detail}`);
		}
	} catch (error) {
		problems.push(`写入 .gitignore 失败：${error instanceof Error ? error.message : String(error)}`);
	}
	if (problems.length > 0) {
		logger.warn("Book root initialized as git repository, but setup commits were incomplete", { root, problems });
	}
	return { status: "initialized" };
}
