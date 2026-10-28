import { randomUUID } from "node:crypto";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	AppError,
	chapters,
	db as runtimeDb,
	deleteProjectById,
	FOLLOW_DEFAULT_MODEL,
	generateId,
	logger,
	narrators,
	NotFoundError,
	projects,
	settings,
	ValidationError,
} from "@vivy1024/narrafork-runtime-bridge";
import {
	getStorageDatabase,
	type LengthCountingMode,
	resolveBookStorageDir,
	resolveLengthCountingMode,
	StateManager,
	type StorageDatabase,
} from "@vivy1024/novelfork-core";
import { and, desc, eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
// The private Runtime tsconfig maps only the plugin root. Keep direct source
// imports limited to novel-plugin domain services rather than copying their
// SQLite and resource contracts into Runtime code.
import { createBookRepository } from "../../../novel-plugin/src/engine/jingwei/repositories/book-repo";
import {
	createJingweiEntriesFromGuide,
	type GuidedSetupAnswers,
	getGenreTemplate,
} from "../../../novel-plugin/src/engine/jingwei";
import { createWritingResourceService } from "../../../novel-plugin/src/engine/writing-resource/service";
import { listChapterFiles, parseChapterFileName } from "../../../novel-plugin/src/engine/writing-resource/chapter-layout";
import { writeFileAtomic } from "../../../novel-plugin/src/engine/writing-resource/atomic-write";
import {
	BookConfigUnreadableError,
	updateBookConfig,
	withBookConfigLock,
} from "../../../novel-plugin/src/engine/book-config/book-config-lock";
import { resolveChapterVolumeDirectory } from "../../../novel-plugin/src/handlers/outline-volume";
import type { WritingResource } from "../../../novel-plugin/src/engine/writing-resource/types";
import { loadWritingSkills } from "../../../novel-plugin/src/engine/writing-skills/loader";
import {
	BookArchiveError,
	importBookArchiveIntoStorage,
	purgeBookArchiveData,
	readBookArchive,
	type BookArchiveImportReport,
	type BookArchiveModuleId,
} from "../../../novel-plugin/src/engine/book-archive";
import {
	recommendWritingSkills,
	type WritingSkillRecommendation,
	type WritingSkillRecommendationInput,
} from "../../../novel-plugin/src/engine/writing-skills/recommend";
import { getNovelForkProductDatabase } from "../db/database";
import { bookProvisionOperations } from "../db/schema";
import { ownsBookBinding } from "../policy/book-product-policy";
import {
	type BookRuntimeBindingRecord,
	bookRuntimeBindingService,
	deriveBookRoot,
	diagnoseTrustedBookRoot,
	ensureBookGitRepository,
	EXTERNAL_BOOK_WORKSPACE_MARKER,
	getControlledBooksRoot,
	probeRuntimeProjectGitPath,
	resolveTrustedBookRoot,
} from "./book-binding";
import { resolveRuntimeOwnerUserId } from "./book-project-owner";

type ProvisionState =
	| "reserved"
	| "core-staged"
	| "filesystem-promoted"
	| "runtime-bound"
	| "ready"
	| "failed"
	| "compensation-required";

type ProvisionOperation = typeof bookProvisionOperations.$inferSelect;

/** 建书成功但有需要作者知道的降级（不落库，只随本次建书结果返回）。 */
export type BookProvisionWarning = {
	readonly code: "BOOK_GIT_INIT_FAILED";
	readonly explanation: string;
};

/** 本次建书流程的结果：持久化的流程记录 + 本次执行中产生的降级说明。 */
type ProvisionResult = ProvisionOperation & { readonly warnings?: readonly BookProvisionWarning[] };

export type ProductBookWorkspaceSource = "none" | "new" | "existing";

export type ProductBookInput = {
	bookId?: string;
	title: string;
	genre?: string;
	language?: "zh" | "en";
	platform?: "tomato" | "feilu" | "qidian" | "other";
	chapterWordCount?: number;
	targetChapters?: number;
	projectInit?: {
		source: ProductBookWorkspaceSource;
		workspaceRoot?: string;
		managedByNovelFork: boolean;
	};
};

export type ProductBookBasicSettingsPatch = {
	title?: string;
	genre?: string;
	language?: "zh" | "en";
	platform?: "tomato" | "feilu" | "qidian" | "other";
	status?: "incubating" | "outlining" | "active" | "paused" | "completed" | "dropped";
	chapterWordCount?: number;
	targetChapters?: number | null;
	arcTrackingMode?: "off" | "rule" | "llm";
	customSensitiveWords?: string;
	/** null 表示删除该字段、回到默认阈值。 */
	foreshadowDebtThresholds?: { watchChapters: number; overdueChapters: number } | null;
};

export type ProductActor = { userId: string; role: "admin" | "user" };

export type ProductBookImportInput = {
	sourcePath: string;
	bookId?: string;
};

export type GuidedSetupAnswer = {
	mode: "preset" | "custom" | "random" | string;
	value: string;
};

export type GuidedSetupInput = {
	answers: Record<string, GuidedSetupAnswer>;
};

export type GuidedSetupResult = {
	ok: true;
	bookId: string;
	createdEntries: number;
	genre: string;
	complexity: "light" | "medium" | "heavy";
	/**
	 * 按建书答案挑出的 Writing Skills 建议。
	 *
 * 只是建议：本接口不写项目 Skill 文件。启用的 Skill 正文会注入
 * 每一章的 style 通道，属于需要作者确认的决定；实际添加由叙述者调
 * 写作台「技能文风 › 写作技能」里勾选完成，由作者确认。
	 */
	recommendedWritingSkills: ReadonlyArray<{
		id: string;
		slug: string;
		name: string;
		kind: string;
		reason: string;
	}>;
	/** 命中的题材簇；null 表示答案未落入任何已知簇，推荐走通用能力位。 */
	matchedGenreCluster: string | null;
};

const READY_STATE: ProvisionState = "ready";
const ROOT_CHAPTER_TITLE = "小说主线";
const NOVELIST_PROMPT =
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 write.preflight 拿到本章写前召回包，再用 scene.spec 建立蓝图，按召回包写好正文后用 pipeline.write 提交；它会执行本书的字数、预设、节拍和审校治理。没有可用文本模型时必须如实说明阻塞，绝不能用 chapter.write 写入短文本充当新章节。chapter.write 仅用于覆盖已存在的完整章节，局部改写使用 rewrite.apply；所有写入都遵守 Runtime 权限确认。通用文件、命令、搜索等工具可以正常使用；但写章节正文请用 chapter.write / pipeline.write，改设定请用 lore.* 工具，这样字数、结算和审计才会正确记录。";

export type RuntimeEntityCapabilities = {
	read: boolean;
	create: boolean;
	update: boolean;
	delete: boolean;
	send: boolean;
	interrupt: boolean;
};

export type ProductBookSummary = {
  id: string;
  title: string;
  status: string;
  /**
   * The Runtime project this book is bound to, when provisioning has got that far.
   *
   * Exposed on purpose: the writing workbench embeds Runtime's own project settings
   * surface (skills, optional tools) for this book, and Runtime addresses those by
   * project id. It grants nothing by itself — every write still passes Runtime's own
   * project ACL, which is owner/grant based (see books' projects rows).
   */
  runtimeProjectId?: string | null;
  platform?: "tomato" | "feilu" | "qidian" | "other";
  chapterWordCount?: number;
  language?: "zh" | "en";
  updatedAt: string;
  capabilities: RuntimeEntityCapabilities;
};

export function getProductBookWritingConfig(
  config: Record<string, unknown>,
): Pick<ProductBookSummary, "platform" | "chapterWordCount" | "language"> {
  return {
    ...(config.platform === "tomato" || config.platform === "feilu" || config.platform === "qidian" || config.platform === "other"
      ? { platform: config.platform }
      : {}),
    ...(typeof config.chapterWordCount === "number"
      && Number.isFinite(config.chapterWordCount)
      && config.chapterWordCount > 0
      ? { chapterWordCount: config.chapterWordCount }
      : {}),
    ...(config.language === "zh" || config.language === "en"
      ? { language: config.language }
      : {}),
  };
}

export type ProductNarratorSummary = {
	id: string;
	bookId: string;
	title: string;
	model: string | null;
	reasoningEffort: string | null;
	permissionMode: string | null;
	planMode: boolean;
	cwd: string | null;
	status: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
	lastMessageAt: string | null;
	errorMessage: string | null;
	capabilities: RuntimeEntityCapabilities;
};

const productNarratorColumns = {
	id: true,
	title: true,
	model: true,
	reasoningEffort: true,
	permissionMode: true,
	planMode: true,
	cwd: true,
	status: true,
	messageCount: true,
	createdAt: true,
	updatedAt: true,
	lastMessageAt: true,
	errorMessage: true,
	traits: true,
} as const;

export type ProductModelStatus = {
	setupRequired: boolean;
	label?: string;
};

export type ProductWorkspaceResource = {
	id: string;
	kind: string;
	title: string;
	content: string;
	path: string;
	metadata: Record<string, unknown>;
	capabilities: RuntimeEntityCapabilities;
};

export type ProductWorkspaceFileEntry = {
	name: string;
	path: string;
	type: "file" | "directory";
	size?: number;
	mtime?: string;
	children?: ProductWorkspaceFileEntry[];
};

export type ProductWorkspaceFileTreeResult = {
	root: string;
	tree: ProductWorkspaceFileEntry[];
	cache: {
		hit: boolean;
		stale: boolean;
		refreshing: boolean;
		generatedAt: string;
	};
};

type WorkspaceFileTreeSnapshot = {
	bookId: string;
	root: string;
	depth: number;
	generation: number;
	tree: ProductWorkspaceFileEntry[];
	generatedAt: number;
};

const MAX_WORKSPACE_TREE_DEPTH = 16;
const MAX_WORKSPACE_FILE_BYTES = 2_000_000;
const WORKSPACE_FILE_TREE_CACHE_TTL_MS = 30_000;
const MAX_WORKSPACE_FILE_TREE_CACHE_ENTRIES = 8;
/** 每本书保留的最近章节变更条数；轮询方落后更多时按"截断"处理，整体刷新。 */
const MAX_CHAPTER_CHANGE_FEED_ENTRIES = 200;
const PROTECTED_WORKSPACE_FILES = new Set(["book.json", "chapters/index.json"]);

function pathIsContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeWorkspacePath(rawPath: string, { allowRoot = false }: { allowRoot?: boolean } = {}): string {
	const trimmed = rawPath.trim().replaceAll("\\", "/");
	if (!trimmed) {
		if (allowRoot) return "";
		throw new ValidationError("workspace path is required");
	}
	if (isAbsolute(trimmed) || /^[A-Za-z]:\//u.test(trimmed)) {
		throw new ValidationError("workspace path must be relative");
	}
	const segments = trimmed.split("/").filter(Boolean);
	if (segments.some((segment) => segment === "." || segment === "..")) {
		throw new ValidationError("workspace path must not traverse outside the book root");
	}
	return segments.join("/");
}

async function resolveWorkspacePath(
	bookRoot: string,
	rawPath: string,
	options: { allowRoot?: boolean; requireExisting?: boolean; allowMissingParents?: boolean } = {},
): Promise<{ absolutePath: string; relativePath: string }> {
	const relativePath = normalizeWorkspacePath(rawPath, { allowRoot: options.allowRoot });
	const absolutePath = resolve(bookRoot, relativePath);
	if (!pathIsContained(bookRoot, absolutePath)) {
		throw new ValidationError("workspace path escapes the trusted book root");
	}

	let existingPath = options.requireExisting === false
		? dirname(absolutePath)
		: absolutePath;
	// 允许缺上级目录时，校验最近一个已存在的祖先：它的真实路径在作品目录内，缺的层级由调用方新建，
	// 新建的目录不可能是符号链接，所以不会被带出作品目录。
	if (options.allowMissingParents && options.requireExisting === false) {
		while (!(await pathExists(existingPath)) && pathIsContained(bookRoot, dirname(existingPath)) && dirname(existingPath) !== existingPath) {
			existingPath = dirname(existingPath);
		}
	}
	const canonicalExistingPath = await realpath(existingPath).catch(() => {
		throw new ValidationError(options.requireExisting === false ? "workspace parent directory does not exist" : "workspace path does not exist");
	});
	if (!pathIsContained(bookRoot, canonicalExistingPath)) {
		throw new ValidationError("workspace path resolves outside the trusted book root");
	}
	return { absolutePath, relativePath };
}

/** 书根的版本库目录：由 git 与 Runtime 管理，不在工作台文件树里出现，也不能经文件网关改动。 */
const WORKSPACE_GIT_DIR = ".git";

function isWorkspaceGitPath(relativePath: string): boolean {
	return relativePath.split("/")[0]?.toLowerCase() === WORKSPACE_GIT_DIR;
}

/** IDE 文件网关写文件的显式意图：编辑器保存为 overwrite，文件树新建 / 复制粘贴为 create。 */
export const WORKSPACE_FILE_WRITE_MODES = ["create", "overwrite"] as const;
export type WorkspaceFileWriteMode = (typeof WORKSPACE_FILE_WRITE_MODES)[number];

/** create 意图遇到已存在的目标：409，带三段式说明。 */
function workspacePathExistsError(relativePath: string): AppError {
	return new AppError(
		[
			`发生了什么：${relativePath} 已经存在，这次新建 / 粘贴没有写入。`,
			"为什么要看：继续写入会用新内容（新建时是空内容）覆盖这个文件，里面已有的正文或设定会丢失。",
			"建议怎么做：换一个文件名再试；确实要替换时，先打开原文件确认内容，再手动编辑或删除后重建。",
		].join("\n"),
		409,
		"WORKSPACE_PATH_EXISTS",
		{ path: relativePath },
	);
}

function assertMutableWorkspacePath(relativePath: string): void {
	if (PROTECTED_WORKSPACE_FILES.has(relativePath)) {
		throw new ValidationError(`${relativePath} is managed by NovelFork and cannot be changed from the IDE file tree`);
	}
	if (isWorkspaceGitPath(relativePath)) {
		throw new ValidationError(
			[
				`发生了什么：${relativePath} 位于作品目录的 .git 版本库里，工作台文件网关不能改动它。`,
				"为什么要看：.git 由 git 和 NovelFork Runtime 管理，改动其中的配置或钩子会破坏版本记录，甚至让 Runtime 执行 git 时运行意外的命令。",
				"建议怎么做：作品内容请在 chapters、story 等目录里编辑；确实需要调整版本库时，请在终端里用 git 命令操作。",
			].join("\n"),
		);
	}
}

const READ_ONLY_CAPABILITIES: RuntimeEntityCapabilities = {
	read: true,
	create: false,
	update: false,
	delete: false,
	send: false,
	interrupt: false,
};

const WORKSPACE_CAPABILITIES: RuntimeEntityCapabilities = {
	read: true,
	create: true,
	update: true,
	delete: false,
	send: false,
	interrupt: false,
};

const CHAPTER_RESOURCE_CAPABILITIES: RuntimeEntityCapabilities = {
	...READ_ONLY_CAPABILITIES,
	update: true,
};

const MAX_WORKSPACE_CONTENT_LENGTH = 2_000_000;

type ControlledChapterFile = {
	number: number;
	fileName: string;
	relativePath: string;
};

function configuredValue(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

/** 对账发现的一次章节变更，返回给写作台用于刷新文件树与已打开的章节。 */
export interface ReconciledChapterSummary {
	readonly chapterNumber: number;
	readonly path: string;
	readonly kind: "created" | "modified";
	readonly wordCount: number;
}

/**
 * 章节变更流水的一次读取结果。
 * - `epoch`：服务进程标识，重启后变化；轮询方发现变化应整体刷新；
 * - `revision`：本书当前修订号，轮询方下次带上它；
 * - `changes`：修订号大于 `since` 的变更，同一路径只留最新一条；
 * - `truncated`：轮询方落后太多，部分变更已不在流水里，应整体刷新。
 */
export interface ChapterChangeFeedRead {
	readonly epoch: string;
	readonly revision: number;
	readonly changes: ReconciledChapterSummary[];
	readonly truncated?: true;
}

interface ChapterChangeFeed {
	revision: number;
	entries: { readonly revision: number; readonly change: ReconciledChapterSummary }[];
}

/** 有凭据的供应商；model 为 null 表示它自己和全局默认模型都没有指定可用模型。 */
type CredentialedProductProvider = { prefix: string; label: string; model: string | null };
type ConfiguredProductProvider = CredentialedProductProvider & { model: string };

/**
 * 供应商实际使用的模型：供应商自己的默认模型优先；为空或是"跟随默认"哨兵时，沿用全局默认模型，
 * 前提是全局默认模型属于这个供应商。NUG 等从网关目录选模型的协议通常不填供应商默认模型，
 * 只在全局默认模型里写完整 ID（如 like:antigravity:gemini-3.8-flash-high）。
 * 前缀拼接规则与 Runtime 的 prefixProviderModel 保持一致。
 */
function resolveProviderModel(prefix: string, defaultModel: string | undefined): string | null {
	const own = defaultModel?.trim();
	if (own && own !== FOLLOW_DEFAULT_MODEL && !own.endsWith(`:${FOLLOW_DEFAULT_MODEL}`)) {
		// 只认「本供应商前缀」：NUG 的默认模型常是「网关通道:模型」（kiro:claude-opus-5.5），
		// 里面的冒号是通道名而不是供应商前缀；见到冒号就原样返回，新叙述者会拿到 kiro:…，
		// Runtime 按 kiro 找供应商而报「Provider "kiro" is not configured」。
		return own.startsWith(`${prefix}:`) ? own : `${prefix}:${own}`;
	}
	const globalDefault = settings.agent.defaultModel?.trim() ?? "";
	return globalDefault.startsWith(`${prefix}:`) ? globalDefault : null;
}

/**
 * 只看本地配置，不做网络探测：配置了密钥和地址，请求时仍可能失败。
 */
function getCredentialedProductProviders(): CredentialedProductProvider[] {
	return [
		...(settings.customApiProviders ?? []),
		...(settings.openaiProviders ?? []),
		...(settings.anthropicProviders ?? []),
		...(settings.nugProviders ?? []),
		...(settings.geminiProviders ?? []),
	]
		.filter(
			(provider) =>
				!provider.disabled &&
				configuredValue(provider.prefix) &&
				configuredValue(provider.apiKey) &&
				configuredValue(provider.baseUrl),
		)
		.map((provider) => ({
			prefix: provider.prefix,
			label: provider.name || provider.prefix,
			model: resolveProviderModel(provider.prefix, provider.defaultModel),
		}));
}

/** 有凭据且能确定模型的供应商：决定模型就绪状态和新叙述者的默认模型。 */
function getConfiguredProductProviders(): ConfiguredProductProvider[] {
	return getCredentialedProductProviders().filter(
		(provider): provider is ConfiguredProductProvider => provider.model !== null,
	);
}

export function getProductModelStatus(): ProductModelStatus {
	const credentialed = getCredentialedProductProviders();
	const configured = credentialed.find((provider) => provider.model !== null);
	if (configured) return { setupRequired: false, label: `已配置：${configured.label}` };
	if (credentialed.length > 0) {
		const names = credentialed.map((provider) => provider.label).join("、");
		return {
			setupRequired: true,
			label: `供应商 ${names} 还没有可用的模型：请为它设置默认模型，或把全局默认模型设为它的模型。`,
		};
	}
	return {
		setupRequired: true,
		label: "尚未配置 AI 供应商：请在设置中添加供应商，并填写 API Key 与服务地址。",
	};
}

/**
 * 叙述者选定的模型已是完整 ID（叙述者自己的或全局默认），Runtime 只按前缀找供应商，
 * 所以只要前缀对应一个有凭据的供应商就能发送，不要求供应商另外设置默认模型。
 */
export function canSendToConfiguredModel(model: string | null): boolean {
	const selected = (model || settings.agent.defaultModel).trim();
	const prefix = selected.includes(":") ? selected.slice(0, selected.indexOf(":")) : "";
	return (
		Boolean(prefix) &&
		getCredentialedProductProviders().some((provider) => provider.prefix === prefix)
	);
}

export function getProductNarratorModel(): string | null {
	return getConfiguredProductProviders()[0]?.model ?? null;
}

function bookCapabilities(): RuntimeEntityCapabilities {
	return { ...READ_ONLY_CAPABILITIES, delete: true };
}

function narratorCapabilities(send: boolean): RuntimeEntityCapabilities {
	return { ...READ_ONLY_CAPABILITIES, send, interrupt: true };
}

function now(): string {
	return new Date().toISOString();
}

function productDb() {
	return getNovelForkProductDatabase();
}

function normalizeBookId(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new ValidationError("bookId must not be empty");
	// deriveBookRoot also rejects traversal and separators. Keeping this check here
	// makes a malformed API request fail before a durable operation is reserved.
	deriveBookRoot(".", normalized);
	return normalized;
}

function generatedBookId(title: string): string {
	const stem = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 30);
	return `${stem || "book"}-${randomUUID().slice(0, 8)}`;
}

/**
 * User-selected absolute workspace roots must stay on that path.
 * Previously only source=existing honored workspaceRoot; source=new silently
 * rewrote book_root into ~/.novelfork/books/<id>, which is a binding bug.
 */
export function isExternalBookWorkspace(
	projectInit?: ProductBookInput["projectInit"],
): boolean {
	if (!projectInit?.workspaceRoot?.trim()) return false;
	return projectInit.source === "existing" || projectInit.source === "new";
}

/**
 * 外部目录路径与 NarraFork 建项目一致：`~` 与 `~/…` 展开为当前用户主目录
 * （Windows 上也接受 `~\…`）。不设允许根：任何登录用户都能指向任意绝对路径。
 */
export function expandWorkspacePath(rawPath: string, home: string = homedir()): string {
	const trimmed = rawPath.trim();
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(home, trimmed.slice(2));
	return trimmed;
}

function normalizeInput(
	input: ProductBookInput,
): Required<Pick<ProductBookInput, "title">> & ProductBookInput {
	const title = input.title.trim();
	if (!title) throw new ValidationError("title is required");
	if (title.length > 200) throw new ValidationError("title must be at most 200 characters");
	const rawProjectInit = input.projectInit as Partial<NonNullable<ProductBookInput["projectInit"]>> | undefined;
	const source = rawProjectInit?.source ?? (rawProjectInit as { repositorySource?: ProductBookWorkspaceSource } | undefined)?.repositorySource ?? "none";
	const rawWorkspaceRoot = rawProjectInit?.workspaceRoot?.trim();
	const workspaceRoot = rawWorkspaceRoot ? expandWorkspacePath(rawWorkspaceRoot) : undefined;
	// External paths are user-owned: never default to managed auto-delete.
	const managedByNovelFork = workspaceRoot
		? false
		: (rawProjectInit?.managedByNovelFork ?? source !== "existing");
	const projectInit = {
		source,
		managedByNovelFork,
		...(workspaceRoot ? { workspaceRoot } : {}),
	};
	if (!["none", "new", "existing"].includes(projectInit.source)) {
		throw new ValidationError("projectInit.source is invalid");
	}
	if (projectInit.source === "existing" && !projectInit.workspaceRoot?.trim()) {
		throw new ValidationError("workspaceRoot is required for an existing workspace");
	}
	if (projectInit.source === "new" && projectInit.managedByNovelFork === false && !projectInit.workspaceRoot?.trim()) {
		throw new ValidationError("workspaceRoot is required when creating an unmanaged new workspace");
	}
	if (projectInit.workspaceRoot && !isAbsolute(projectInit.workspaceRoot.trim())) {
		throw new ValidationError("workspaceRoot must be an absolute path");
	}
	if (
		input.chapterWordCount !== undefined &&
		(!Number.isInteger(input.chapterWordCount) || input.chapterWordCount < 500)
	) {
		throw new ValidationError("chapterWordCount must be an integer of at least 500");
	}
	if (
		input.targetChapters !== undefined &&
		(!Number.isInteger(input.targetChapters) || input.targetChapters < 1)
	) {
		throw new ValidationError("targetChapters must be a positive integer");
	}
	return {
		...input,
		title,
		projectInit: {
			source: projectInit.source,
			managedByNovelFork: projectInit.managedByNovelFork,
			...(projectInit.workspaceRoot?.trim() ? { workspaceRoot: projectInit.workspaceRoot.trim() } : {}),
		},
		bookId: input.bookId ? normalizeBookId(input.bookId) : undefined,
	};
}

function operationState(operation: ProvisionOperation): ProvisionState {
	return operation.state as ProvisionState;
}

function publicOperation(operation: ProvisionResult) {
	return {
		id: operation.id,
		bookId: operation.bookId,
		state: operationState(operation),
		runtimeProjectId: operation.runtimeProjectId,
		runtimeChapterId: operation.runtimeChapterId,
		narratorId: operation.narratorId,
		error: operation.errorMessage,
		createdAt: operation.createdAt,
		updatedAt: operation.updatedAt,
		...(operation.warnings?.length ? { warnings: operation.warnings } : {}),
	};
}

async function pathExists(path: string): Promise<boolean> {
	return Boolean(await stat(path).catch(() => null));
}

/** 已经是一本作品的标志文件：新建作品不能落在这样的目录里。 */
const EXISTING_BOOK_MARKERS = ["book.json", join("chapters", "index.json")] as const;

function workspaceAlreadyABookError(workspaceRoot: string, marker: string): ValidationError {
	return new ValidationError(
		`所选目录 ${workspaceRoot} 里已经有 ${marker}，它已经是一本作品。` +
			"新建作品会在这个目录里写入新的作品配置与章节索引，可能与已有内容冲突或覆盖它。" +
			"请改用「导入已有作品」接入这本书，或为新作品另选一个目录。",
		"WORKSPACE_ALREADY_A_BOOK",
	);
}

/**
 * 建书指定的 bookId 在受控书籍根下已有同名目录。建书只会在全新目录里落脚手架，
 * 已有的目录（尤其是没有建书记录、没有绑定的旧书）不能被建书沿用：那等于让任何带上这个
 * bookId 的人把别人的书收进自己的书架。旧书只能由管理员走「认领」接入。
 */
function controlledBookRootOccupiedError(bookId: string, isBook: boolean, isAdmin: boolean): ValidationError {
	const what = isBook
		? `发生了什么：作品 ID「${bookId}」在受控作品目录里已经有一本作品，新建作品被拒绝，本次没有写入任何内容。`
		: `发生了什么：作品 ID「${bookId}」在受控作品目录里已经有同名目录，新建作品被拒绝，本次没有写入任何内容。`;
	const why = "为什么要看：新建作品不会接管已有目录，以免把别人的书或其他内容收进你的书架。";
	const advice = isAdmin && isBook
		? "建议怎么做：如需接入这本旧书，请对它执行「认领」；要新建作品，请换一个作品 ID 或留空让系统生成。"
		: "建议怎么做：请换一个作品 ID，或留空让系统生成；如果这是你以前的书，请联系管理员认领。";
	return new ValidationError([what, why, advice].join("\n"), "BOOK_ROOT_ALREADY_EXISTS");
}

/** 这条建书记录是否由 create() 发起（区别于认领、修复、导入接入已有目录的记录）。 */
function isCreateOperation(operation: ProvisionOperation): boolean {
	const input = operation.inputJson as { provisionOrigin?: unknown } | null;
	return input?.provisionOrigin === "create";
}

/**
 * 数据安全检查（不是权限限制）：source=new 指向的目录若已经是一本作品，建书前拒绝，
 * 不留任何记录。其余非空目录允许（与 NarraFork 一样接受已有目录），
 * 脚手架只写不存在的文件，见 `writeBookScaffold`。
 */
async function assertNewWorkspaceIsNotABook(input: ProductBookInput): Promise<void> {
	const projectInit = input.projectInit;
	if (!projectInit || projectInit.source !== "new" || !isExternalBookWorkspace(projectInit)) return;
	const workspaceRoot = resolve(projectInit.workspaceRoot as string);
	const info = await stat(workspaceRoot).catch(() => null);
	if (!info?.isDirectory()) return;
	for (const marker of EXISTING_BOOK_MARKERS) {
		if (await pathExists(join(workspaceRoot, marker))) {
			throw workspaceAlreadyABookError(workspaceRoot, marker);
		}
	}
}

async function listControlledChapterFiles(bookRoot: string): Promise<ControlledChapterFile[]> {
	const files = await listChapterFiles(bookRoot);
	return files.map((file) => ({
		number: file.number,
		fileName: file.fileName,
		relativePath: file.relativePath,
	}));
}

function chapterResourceId(number: number): string {
	return `chapter:${number}`;
}

function chapterTitle(file: ControlledChapterFile, content: string): string {
	const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
	if (heading) return heading;
	const stem = file.fileName
		.replace(/^\d+[_-]/u, "")
		.replace(/\.md$/iu, "")
		.replace(/[_-]+/gu, " ")
		.trim();
	return stem || `第 ${file.number} 章`;
}

async function listMarkdownResources(
	bookRoot: string,
	bookId: string,
): Promise<ProductWorkspaceResource[]> {
	const resources: ProductWorkspaceResource[] = [];
	const walk = async (
		folder: "chapters" | "story" | "jingwei",
		relativeDir: string,
	): Promise<void> => {
		const absoluteDir = join(bookRoot, relativeDir);
		const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			const relativePath = join(relativeDir, entry.name);
			if (entry.isDirectory()) {
				await walk(folder, relativePath);
				continue;
			}
			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
			const content = await readFile(join(bookRoot, relativePath), "utf8").catch(() => null);
			if (content === null) continue;
			const normalizedPath = relativePath.replaceAll("\\", "/");
			const parsedChapter = folder === "chapters" ? parseChapterFileName(entry.name) : null;
			const chapter = parsedChapter
				? { ...parsedChapter, relativePath: normalizedPath }
				: null;
			const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
			resources.push({
				id: chapter ? chapterResourceId(chapter.number) : `${folder}:${normalizedPath}`,
				kind: chapter ? "chapter" : folder,
				title: chapter ? chapterTitle(chapter, content) : heading || basename(entry.name, ".md"),
				content,
				path: normalizedPath,
				metadata: {
					bookId,
					fileName: folder === "chapters" ? normalizedPath : entry.name,
					...(chapter ? { chapterNumber: chapter.number, isChapter: true } : {}),
				},
				capabilities: chapter
					? { ...CHAPTER_RESOURCE_CAPABILITIES }
					: { ...READ_ONLY_CAPABILITIES },
			});
		}
	};
	await Promise.all([
		walk("chapters", "chapters"),
		walk("story", "story"),
		walk("jingwei", "jingwei"),
	]);
	return resources;
}

function countWords(content: string): number {
	return (content.trim().match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function sanitizeChapterTitle(title: string): string {
	return title
		.trim()
		.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
		.replace(/\s+/gu, " ")
		.replace(/[-_]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 100);
}

function parseChapterResourceId(resourceId: string): number {
	const match = /^chapter:(\d{1,9})$/u.exec(resourceId);
	const number = match ? Number(match[1]) : Number.NaN;
	if (!Number.isSafeInteger(number) || number < 1) {
		throw new ValidationError("workspace resourceId must identify a chapter resource");
	}
	return number;
}

/**
 * 锁内读改写 book.json（见 book-config-lock.ts）。读不出或解析失败时转成带三段式说明的
 * ValidationError，不把损坏的 book.json 当成空对象覆盖掉。
 */
async function updateBookConfigExplained(
	bookRoot: string,
	mutate: (current: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
	try {
		return await updateBookConfig(bookRoot, (current) => {
			if (!current) throw new ValidationError("Book does not have a readable book.json");
			return mutate(current);
		});
	} catch (error) {
		if (error instanceof BookConfigUnreadableError) throw new ValidationError(error.message);
		throw error;
	}
}

/**
 * 章节保存、新建章、章节对账后刷新书籍时间戳：锁内重读最新 book.json，只改 updatedAt。
 * 不接收调用方在请求开始时读到的配置，否则会把期间别处对设置的修改整份冲掉。
 * 正文已经写成功，时间戳只是附带动作：book.json 不存在或读不出时记一条日志并跳过，
 * 不把一次成功的保存报成失败。
 */
async function updateBookTimestamp(bookRoot: string): Promise<void> {
	try {
		await updateBookConfig(bookRoot, (current) => (current ? { ...current, updatedAt: now() } : null));
	} catch (error) {
		if (!(error instanceof BookConfigUnreadableError)) throw error;
		logger.warn("Skipped book.json timestamp refresh: book.json is unreadable", {
			bookRoot,
			detail: error.message,
		});
	}
}

/**
 * 旧版「导入已有作品目录」把 book.json 与 chapters/index.json 的结尾写成了字面的反斜杠 + n，
 * 导致 JSON 无法解析（章节索引会被静默读成空）。只修这一种确定的损坏：末尾恰好是这两个字符、
 * 去掉后能正常解析时才改写为正常换行；其他任何情况原样保留、按原逻辑报错。
 */
const LITERAL_NEWLINE_TAIL = String.fromCharCode(92) + "n";

export async function repairLegacyImportTail(path: string, raw: string): Promise<string> {
	const trimmed = raw.trimEnd();
	if (!trimmed.endsWith(LITERAL_NEWLINE_TAIL)) return raw;
	const candidate = trimmed.slice(0, -LITERAL_NEWLINE_TAIL.length);
	try {
		JSON.parse(candidate);
	} catch {
		return raw;
	}
	const repaired = `${candidate}\n`;
	const temporary = `${path}.repair-${randomUUID()}.tmp`;
	await writeFile(temporary, repaired, "utf8");
	await rename(temporary, path);
	console.warn(`[book-provision] 已修复旧版导入写坏的文件结尾：${path}`);
	return repaired;
}

async function repairLegacyImportArtifacts(bookRoot: string): Promise<void> {
	const indexPath = join(bookRoot, "chapters", "index.json");
	const indexRaw = await readFile(indexPath, "utf8").catch(() => null);
	if (indexRaw !== null) await repairLegacyImportTail(indexPath, indexRaw).catch(() => undefined);
}

async function readBookConfig(
	bookRoot: string,
	expectedBookId: string,
): Promise<Record<string, unknown>> {
	const configPath = join(bookRoot, "book.json");
	const original = await readFile(configPath, "utf8").catch(() => {
		throw new ValidationError("Book does not have a readable book.json");
	});
	const raw = await repairLegacyImportTail(configPath, original).catch(() => original);
	await repairLegacyImportArtifacts(bookRoot);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ValidationError("Book has an invalid book.json");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ValidationError("Book has an invalid book.json");
	}
	const config = parsed as Record<string, unknown>;
	if (config.id !== expectedBookId || typeof config.title !== "string") {
		throw new ValidationError("Book metadata does not match its controlled book id");
	}
	return config;
}

async function assertNoSymbolicLinks(root: string): Promise<void> {
	const entries = await readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = join(root, entry.name);
		if (entry.isSymbolicLink()) throw new ValidationError("作品目录不能包含符号链接");
		if (entry.isDirectory()) await assertNoSymbolicLinks(entryPath);
	}
}

async function readImportBookConfig(sourceRoot: string): Promise<Record<string, unknown>> {
	const raw = await readFile(join(sourceRoot, "book.json"), "utf8").catch(() => {
		throw new ValidationError("所选目录不是有效作品：缺少 book.json");
	});
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ValidationError("所选作品的 book.json 无法解析");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ValidationError("所选作品的 book.json 格式无效");
	}
	const config = parsed as Record<string, unknown>;
	if (typeof config.title !== "string" || !config.title.trim()) {
		throw new ValidationError("所选作品缺少有效标题");
	}
	return config;
}

async function syncImportedChapters(bookId: string, bookRoot: string): Promise<void> {
	const service = createDomainWritingResourceService(bookId, bookRoot);
	for (const chapter of await listControlledChapterFiles(bookRoot)) {
		const content = await readFile(join(bookRoot, chapter.relativePath), "utf8").catch(() => null);
		if (content === null || (await service.findAcceptedChapter(bookId, chapter.number))) continue;
		await service.create(bookId, {
			type: "chapter",
			status: "accepted",
			title: chapterTitle(chapter, content),
			content,
			chapterNumber: chapter.number,
			source: "import:filesystem",
			metadata: { imported: true, fileName: chapter.fileName },
		});
	}
}

function buildBookConfig(operation: ProvisionOperation): Record<string, unknown> {
	const input = operation.inputJson as ProductBookInput;
	const isExternalWorkspace = isExternalBookWorkspace(input.projectInit);
	return {
		id: operation.bookId,
		title: operation.title,
		platform: input.platform ?? "other",
		genre: input.genre?.trim() || "未分类",
		status: "outlining",
		chapterWordCount: input.chapterWordCount ?? 3000,
		...(input.targetChapters ? { targetChapters: input.targetChapters } : {}),
		...(input.language ? { language: input.language } : {}),
		...(isExternalWorkspace ? { [EXTERNAL_BOOK_WORKSPACE_MARKER]: true } : {}),
		createdAt: operation.createdAt,
		updatedAt: now(),
	};
}

function normalizeGuidedSetupAnswers(
	raw: Record<string, GuidedSetupAnswer> | undefined,
): GuidedSetupAnswers {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ValidationError("guided-setup answers must be an object");
	}
	const answers: Record<string, GuidedSetupAnswer> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!key.trim()) continue;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new ValidationError(`guided-setup answer "${key}" is invalid`);
		}
		const mode = typeof value.mode === "string" ? value.mode : "random";
		const answerValue = typeof value.value === "string" ? value.value : "";
		answers[key] = { mode, value: answerValue };
	}
	return answers as GuidedSetupAnswers;
}

function guidedAnswerText(answer: { mode: string; value: string } | undefined): string | null {
	if (!answer || answer.mode === "random") return null;
	const text = answer.value?.trim();
	return text ? text : null;
}

function parseGuidedChapterWordCount(raw: string | null): number | null {
	if (!raw) return null;
	const digits = raw.match(/\d{3,6}/u)?.[0];
	if (!digits) return null;
	const n = Number(digits);
	if (!Number.isSafeInteger(n) || n < 500 || n > 100_000) return null;
	return n;
}

function mapGuidedPlatform(raw: string | null): "tomato" | "feilu" | "qidian" | "other" | null {
	if (!raw) return null;
	const value = raw.trim().toLowerCase();
	if (value.includes("番茄") || value.includes("tomato")) return "tomato";
	if (value.includes("飞卢") || value.includes("feilu")) return "feilu";
	if (value.includes("起点") || value.includes("qidian")) return "qidian";
	if (value.includes("晋江") || value.includes("七猫") || value.includes("暂不确定")) return "other";
	return "other";
}

async function appendGuidedStoryNotes(
	bookRoot: string,
	answers: GuidedSetupAnswers,
): Promise<void> {
	const premise = guidedAnswerText(answers.premise);
	const protagonist = guidedAnswerText(answers.protagonist);
	const goldenFinger = guidedAnswerText(answers.goldenFinger);
	const world = guidedAnswerText(answers.worldModel);
	const tone = guidedAnswerText(answers.tone);
	const lines: string[] = [];
	if (premise) lines.push(`## 核心前提\n${premise}`);
	if (protagonist) lines.push(`## 主角\n${protagonist}`);
	if (goldenFinger) lines.push(`## 金手指\n${goldenFinger}`);
	if (world) lines.push(`## 世界观\n${world}`);
	if (tone) lines.push(`## 文风基调\n${tone}`);
	if (lines.length === 0) return;

	const authorIntentPath = join(bookRoot, "story", "author_intent.md");
	const existing = await readFile(authorIntentPath, "utf8").catch(() => "# 作者意图\n\n");
	const stamp = new Date().toISOString().slice(0, 10);
	const block = `\n\n## 新书引导（${stamp}）\n\n${lines.join("\n\n")}\n`;
	if (existing.includes("## 新书引导（")) {
		// Keep first guided seed; later completions should not duplicate.
		return;
	}
	await writeFile(authorIntentPath, `${existing.trimEnd()}${block}`, "utf8");
}

async function writeBookConfig(
	bookRoot: string,
	config: Record<string, unknown>,
	options?: { readonly exclusive?: boolean },
): Promise<void> {
	const content = `${JSON.stringify(config, null, 2)}\n`;
	// 与其他 book.json 写入方共用按书锁（book-config-lock.ts），不与它们交错。
	// 覆盖更新走原子写（临时文件 + fsync + rename）：写入中断时 book.json 只会是旧版或新版，
	// 不留半截配置导致整本书不可读。独占新建（wx）不能用 rename 覆盖，保持原语义，
	// 以免覆盖用户目录里已有的 book.json。
	// 覆盖写会整份替换文件：只用于调用方已在同一把锁里重读过最新内容的场景；
	// 修改已有书的字段请用 updateBookConfigExplained。
	await withBookConfigLock(bookRoot, async () => {
		if (options?.exclusive) {
			await writeFile(join(bookRoot, "book.json"), content, { encoding: "utf8", flag: "wx" });
			return;
		}
		await writeFileAtomic(join(bookRoot, "book.json"), content);
	});
}

async function initializeExternalBookConfig(
	bookRoot: string,
	operation: ProvisionOperation,
): Promise<void> {
	try {
		await writeBookConfig(bookRoot, buildBookConfig(operation), { exclusive: true });
	} catch (error) {
		if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
		await readImportBookConfig(bookRoot);
	}
}

async function writeBookScaffold(bookRoot: string, operation: ProvisionOperation): Promise<void> {
	const config = buildBookConfig(operation);
	const isEnglish = config.language === "en";
	const storyFiles: ReadonlyArray<[string, string]> = isEnglish
		? [
				["book_rules.md", "# Book Rules\n\nRecord writing constraints here.\n"],
				["current_state.md", "# Current State\n\nNo chapters have been written yet.\n"],
				["volume_outline.md", "# Volume Outline\n\n"],
				["author_intent.md", "# Author Intent\n\n"],
				["current_focus.md", "# Current Focus\n\n"],
			]
		: [
				["book_rules.md", "# 写作规则\n\n在这里记录本书的写作约束、禁忌和统一口径。\n"],
				["current_state.md", "# 当前状态\n\n尚未写入章节。\n"],
				["volume_outline.md", "# 分卷大纲\n\n"],
				["author_intent.md", "# 作者意图\n\n"],
				["current_focus.md", "# 当前聚焦\n\n"],
			];
	await mkdir(join(bookRoot, "story", "runtime"), { recursive: true });
	await mkdir(join(bookRoot, "chapters"), { recursive: true });
	// 脚手架可能写进用户已有的目录（source=new 指向非空目录）：一律只写不存在的文件，
	// 绝不覆盖用户已有的同名文件。book.json 已存在时只接受本书自己的（中断后重试）。
	try {
		await writeBookConfig(bookRoot, config, { exclusive: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		await readBookConfig(bookRoot, operation.bookId).catch(() => {
			throw workspaceAlreadyABookError(bookRoot, "book.json");
		});
	}
	await writeFileIfAbsent(join(bookRoot, "chapters", "index.json"), "[]\n");
	await Promise.all(
		storyFiles.map(([name, content]) => writeFileIfAbsent(join(bookRoot, "story", name), content)),
	);
}

async function writeFileIfAbsent(path: string, content: string): Promise<void> {
	try {
		await writeFile(path, content, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

/** 删书流程的控制表：由 deleteBook 按顺序最后删除，清理书籍数据时不能提前删掉，否则失败后无法重试。 */
const BOOK_DELETE_CONTROL_TABLES = new Set(["book_provision_operations", "book_runtime_bindings"]);

/**
 * 清掉产品库里属于这本书的全部数据（单事务）。
 *
 * 先交给领域代码 `purgeBookArchiveData`：它知道只靠父表关联、自身没有 book_id 的子表，
 * 以及 FTS 索引的清理方式（必须在删 jingwei_fts_doc 之前做），并在它的清单之后删 book 行。
 * 再枚举库里所有带 book_id 列的表逐一删除，按需建表的叙事记忆表、workflow_runs、日志等
 * 不必登记也不会残留（workflow_run_steps 等子表经 ON DELETE CASCADE 随父表删除；
 * 现有指向 book 的外键也都是 CASCADE）。最后再删一次 book 行，兜住领域清单跳过的情况。
 */
function purgeBookScopedStorage(storage: StorageDatabase, bookId: string): void {
	storage.sqlite.transaction(() => {
		purgeBookArchiveData(storage, bookId);
		const tables = storage.sqlite
			.prepare(
				`SELECT DISTINCT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p
				 WHERE m.type = 'table' AND p.name = 'book_id'`,
			)
			.all() as Array<{ name: string }>;
		for (const { name } of tables) {
			if (BOOK_DELETE_CONTROL_TABLES.has(name)) continue;
			storage.sqlite.prepare(`DELETE FROM "${name.replaceAll('"', '""')}" WHERE book_id = ?`).run(bookId);
		}
		storage.sqlite.prepare(`DELETE FROM "book" WHERE id = ?`).run(bookId);
	})();
}

/**
 * 书根是否是 NovelFork 自己管理的目录：realpath 后是受控书籍根的直接子目录。
 * 只认直接子目录，既不会删到受控根本身，也不会删到别的书目录里的一部分。
 */
async function isProductOwnedBookRoot(bookRoot: string): Promise<boolean> {
	const [controlledRoot, physicalRoot] = await Promise.all([
		realpath(getControlledBooksRoot()).catch(() => null),
		realpath(bookRoot).catch(() => null),
	]);
	if (!controlledRoot || !physicalRoot) return false;
	const rel = relative(controlledRoot, physicalRoot);
	return rel !== "" && rel !== ".." && !isAbsolute(rel) && !/[\\/]/u.test(rel);
}

const BOOK_GIT_FAILURE_LABEL = {
	"git-unavailable": "找不到 git 程序",
	timeout: "git 命令超时",
	failed: "git 命令失败",
} as const;

/**
 * 建书时把受控书根初始化为 git 仓库（NarraFork 的项目即 git 仓库）。git 不可用时建书照常完成，
 * 返回一条说明；删书时另有兜底（见 prepareRuntimeProjectGitPath），不会因此删不掉。
 */
async function initializeControlledBookGit(
	root: string,
	creatorUserId: string | null,
): Promise<BookProvisionWarning | null> {
	const result = await ensureBookGitRepository(root, { creatorUserId });
	if (result.status !== "failed") return null;
	logger.warn("Controlled book root could not be initialized as a git repository", {
		root,
		reason: result.reason,
		detail: result.detail,
	});
	return {
		code: "BOOK_GIT_INIT_FAILED",
		explanation: [
			`发生了什么：作品目录 ${root} 没能初始化为 git 仓库（${BOOK_GIT_FAILURE_LABEL[result.reason]}：${result.detail}）。作品本身已经建好，可以正常写作。`,
			"为什么要看：NovelFork Runtime 把每个项目当作 git 仓库管理，这本书在 Runtime 里的版本记录、分支对比等 git 功能不可用；删除这本书不受影响，会自动兜底。",
			"建议怎么做：安装 git 并确认运行 NovelFork 的进程能在 PATH 里找到它；如果只用 NovelFork 写作，可以忽略这条提示。",
		].join("\n"),
	};
}

/**
 * 删书第 1 步之前：让 Runtime 删项目时的 git 核实能通过，同时绝不在用户的外部目录里执行 git init。
 *
 * Runtime 0.8.3 删除项目前会在 gitPath 上执行 `git rev-parse --git-common-dir`，失败就拒绝（409），
 * 而 v0.0.4 建在受控目录里的书都不是 git 仓库，所以删不掉。
 * - gitPath 能通过核实（本身是仓库或位于仓库里）：不动；
 * - gitPath 就是 NovelFork 自己管理的书根：按建书口径补做 git 初始化；
 * - 外部目录不是仓库、目录已经不在、git 不可用或补做失败：把这条 Runtime 项目的 gitPath 置空，
 *   Runtime 就跳过 git 核实与 worktree 清理（不是仓库的目录本来也不可能挂着工作树），目录本身原样保留；
 * - 核实超时：不置空，交给 Runtime 自己判断，免得把一次卡顿当成「不是仓库」而绕过资源保护。
 * 可重入：gitPath 置空后再删一次会直接跳过这一步。
 */
async function prepareRuntimeProjectGitPath(
	project: { readonly id: string; readonly gitPath: string | null },
	ownedBookRoot: string | null,
	creatorUserId: string | null,
): Promise<void> {
	if (!project.gitPath) return;
	const probe = await probeRuntimeProjectGitPath(project.gitPath);
	if (probe.ok || probe.reason === "timeout") return;
	let detail = probe.detail;
	if (ownedBookRoot && (await realpath(project.gitPath).catch(() => null)) === ownedBookRoot) {
		const ensured = await ensureBookGitRepository(ownedBookRoot, { creatorUserId });
		if (ensured.status !== "failed") {
			const recheck = await probeRuntimeProjectGitPath(project.gitPath);
			if (recheck.ok) return;
			detail = recheck.detail;
		} else {
			detail = ensured.detail;
		}
	}
	logger.warn("Clearing Runtime project gitPath before deletion: path is not a usable git repository", {
		projectId: project.id,
		gitPath: project.gitPath,
		controlled: Boolean(ownedBookRoot),
		detail,
	});
	await runtimeDb
		.update(projects)
		.set({ gitPath: null, updatedAt: now() })
		.where(eq(projects.id, project.id));
}

/** Runtime 资源保护拒绝删除时的错误码（worktree-lifecycle-guard 的 ResourceProtectionError，409）。 */
const RUNTIME_RESOURCE_PROTECTION_CODES = new Set(["RESOURCE_PROTECTED", "RESOURCE_PROTECTION_UNAVAILABLE"]);

/** 删除 Runtime 项目；Runtime 以资源保护为由拒绝时换成作者看得懂的三段式说明，状态码与错误码不变。 */
async function deleteRuntimeProjectExplained(projectId: string): Promise<void> {
	try {
		await deleteProjectById(projectId);
	} catch (error) {
		if (!(error instanceof AppError) || !RUNTIME_RESOURCE_PROTECTION_CODES.has(error.code)) throw error;
		throw new AppError(
			[
				`发生了什么：NovelFork Runtime 拒绝删除这本书对应的 Runtime 项目（${error.message}）。`,
				"为什么要看：Runtime 发现这本书的工作区还被占用，或无法确认没有被占用；为了不误删正在使用的内容，删除在第一步就停下了，书、章节和目录都原样保留。",
				"建议怎么做：先停掉这本书正在运行的叙述者，关闭在 Runtime 里打开的终端或分支工作区，然后再删一次；仍然失败时，请把这条信息和 Runtime 日志一起反馈。",
			].join("\n"),
			error.statusCode,
			error.code,
		);
	}
}

function resolveDomainBookRoot(bookId: string): string {
	return resolveBookStorageDir(dirname(getControlledBooksRoot()), bookId);
}

/** 书籍计数方式：英文书按词、其余按中文字符，与章节长度校验一致。 */
function bookCountingMode(config: Record<string, unknown>): LengthCountingMode {
	return resolveLengthCountingMode(config.language === "en" ? "en" : "zh");
}

function isChapterPath(relativePath: string): boolean {
	return relativePath === "chapters" || relativePath.startsWith("chapters/");
}

function createDomainWritingResourceService(
	bookId: string,
	bookRoot?: string,
	countingMode?: LengthCountingMode,
) {
	const domainRoot = bookRoot ?? resolveDomainBookRoot(bookId);
	return createWritingResourceService({
		storage: getStorageDatabase(),
		countingMode,
		resolveBookDir: (requestedBookId) => {
			if (requestedBookId !== bookId)
				throw new ValidationError("Writing resource book binding mismatch");
			return domainRoot;
		},
		resolveChapterVolumeDirectory: (requestedBookId, chapterNumber) => {
			if (requestedBookId !== bookId)
				throw new ValidationError("Writing resource book binding mismatch");
			return resolveChapterVolumeDirectory(getStorageDatabase(), requestedBookId, chapterNumber);
		},
	});
}

function workspaceResourceId(resource: WritingResource): string {
	if (resource.type === "chapter" && resource.status === "accepted" && resource.chapterNumber) {
		return chapterResourceId(resource.chapterNumber);
	}
	return `${resource.type}:${resource.id}`;
}

function toWorkspaceWritingResource(resource: WritingResource): ProductWorkspaceResource {
	const editable = resource.status === "accepted";
	const chapterFileName = typeof resource.metadata.fileName === "string"
		? resource.metadata.fileName.replaceAll("\\", "/").replace(/^chapters\//u, "")
		: null;
	const workspacePath = resource.type === "chapter" && resource.status === "accepted" && chapterFileName
		? `chapters/${chapterFileName}`
		: `writing-resources/${resource.id}`;
	return {
		id: workspaceResourceId(resource),
		kind: resource.type,
		title:
			resource.title || (resource.chapterNumber ? `第 ${resource.chapterNumber} 章` : "未命名资源"),
		content: resource.content,
		path: workspacePath,
		metadata: {
			...resource.metadata,
			bookId: resource.bookId,
			resourceId: resource.id,
			chapterNumber: resource.chapterNumber ?? undefined,
			status: resource.status,
			wordCount: resource.wordCount,
			version: resource.version,
			source: resource.source ?? undefined,
			createdAt: new Date(resource.createdAt).toISOString(),
			updatedAt: new Date(resource.updatedAt).toISOString(),
		},
		capabilities: {
			...READ_ONLY_CAPABILITIES,
			update: editable,
			delete: resource.status !== "accepted",
		},
	};
}

function rawWritingResourceId(resourceId: string): string {
	const match = /^(?:candidate|draft|chapter):(.+)$/u.exec(resourceId);
	return match?.[1] ?? resourceId;
}

export class NovelForkProductBookService {
	private readonly workspaceFileTreeCache = new Map<string, WorkspaceFileTreeSnapshot>();
	private readonly workspaceFileTreeBuilds = new Map<string, Promise<WorkspaceFileTreeSnapshot>>();
	private readonly workspaceFileTreeGenerations = new Map<string, number>();
	private readonly chapterIndexLocks = new Map<string, Promise<unknown>>();
	/**
	 * 对账可能由写作台轮询、加载工作区、文件网关写入等多个入口触发；发现的变更一律记进流水，
	 * 轮询方按修订号取回，谁触发的对账都不会让别的界面漏掉通知。
	 */
	private readonly chapterChangeFeeds = new Map<string, ChapterChangeFeed>();
	private readonly chapterChangeEpoch = randomUUID();

	private recordChapterChanges(bookId: string, changes: readonly ReconciledChapterSummary[]): void {
		if (changes.length === 0) return;
		const feed = this.chapterChangeFeeds.get(bookId) ?? { revision: 0, entries: [] };
		for (const change of changes) {
			feed.revision += 1;
			feed.entries.push({ revision: feed.revision, change });
		}
		if (feed.entries.length > MAX_CHAPTER_CHANGE_FEED_ENTRIES) {
			feed.entries.splice(0, feed.entries.length - MAX_CHAPTER_CHANGE_FEED_ENTRIES);
		}
		this.chapterChangeFeeds.set(bookId, feed);
	}

	private readChapterChangeFeed(bookId: string, since: number | undefined): ChapterChangeFeedRead {
		const feed = this.chapterChangeFeeds.get(bookId) ?? { revision: 0, entries: [] };
		const base = { epoch: this.chapterChangeEpoch, revision: feed.revision };
		// 首次读取只拿基准修订号：此前的变更已经反映在轮询方刚加载的内容里。
		if (since === undefined || since >= feed.revision) return { ...base, changes: [] };
		const latestByPath = new Map<string, ReconciledChapterSummary>();
		for (const entry of feed.entries) {
			if (entry.revision > since) latestByPath.set(entry.change.path, entry.change);
		}
		const oldest = feed.entries[0]?.revision;
		const truncated = oldest === undefined || oldest > since + 1;
		return { ...base, changes: [...latestByPath.values()], ...(truncated ? { truncated: true as const } : {}) };
	}

	/**
	 * 同一本书的章节索引读改写串行执行：写作台保存与章节对账都会改 chapters/index.json，
	 * 交错时保存写进索引的结果会被对账覆盖，下一次对账就会把这次保存的增量重复记一遍。
	 */
	private withChapterIndexLock<T>(bookId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.chapterIndexLocks.get(bookId) ?? Promise.resolve();
		const run = previous.catch(() => undefined).then(task);
		const tail = run.catch(() => undefined);
		this.chapterIndexLocks.set(bookId, tail);
		void tail.then(() => {
			if (this.chapterIndexLocks.get(bookId) === tail) this.chapterIndexLocks.delete(bookId);
		});
		return run;
	}

	/**
	 * 章节文件对账：补做绕过产品层的写入（叙述者通用写工具、Runtime 编辑器与回退、外部编辑器）
	 * 漏掉的附带动作——写作日志、审计过期标记、索引字数、书籍时间戳、文件树缓存。
	 *
	 * 写作管线与领域工具写章时持有书籍写锁；拿不到锁就跳过本轮，等下次对账，不与它们交错。
	 */
	private async reconcileBookChapters(
		bookId: string,
		root: string,
		config: Record<string, unknown>,
	): Promise<ReconciledChapterSummary[]> {
		return this.withChapterIndexLock(bookId, async () => {
			let release: (() => Promise<void>) | undefined;
			try {
				release = await new StateManager("", { resolveBookDir: () => root }).acquireBookLock(bookId);
			} catch {
				return [];
			}
			try {
				const changes = await createDomainWritingResourceService(
					bookId,
					root,
					bookCountingMode(config),
				).reconcileChapters(bookId);
				if (changes.length === 0) return [];
				await updateBookTimestamp(root);
				this.invalidateWorkspaceFileTree(bookId);
				const summaries = changes.map((change) => ({
					chapterNumber: change.chapterNumber,
					path: change.relativePath,
					kind: change.kind,
					wordCount: change.wordCount,
				}));
				this.recordChapterChanges(bookId, summaries);
				return summaries;
			} finally {
				await release().catch(() => undefined);
			}
		});
	}

	/** 先对账，再按修订号读取变更流水。`since` 为轮询方上次拿到的修订号，首次不传。 */
	async reconcileWorkspaceChapters(
		bookId: string,
		actor: ProductActor,
		since?: number,
	): Promise<ChapterChangeFeedRead> {
		const { root, config, operation } = await this.getReadyBookRoot(bookId, actor);
		await this.reconcileBookChapters(operation.bookId, root, config);
		return this.readChapterChangeFeed(operation.bookId, since);
	}

	async listReadyBooks(actor: ProductActor): Promise<ProductBookSummary[]> {
		const operations = await productDb().query.bookProvisionOperations.findMany({
			where: eq(bookProvisionOperations.state, READY_STATE),
			orderBy: [desc(bookProvisionOperations.updatedAt)],
		});
		const results: ProductBookSummary[] = [];
		for (const operation of operations) {
			const binding = await bookRuntimeBindingService.getByBookId(operation.bookId);
			if (!binding || !this.canAccessBinding(actor, binding)) continue;
			const input = operation.inputJson as ProductBookInput;
			const root = await resolveTrustedBookRoot(
				binding,
				getControlledBooksRoot(),
				isExternalBookWorkspace(input.projectInit),
			);
			// T-17：book.json 损坏或读取失败只让写作配置字段缺省，不让书从书架消失。
			// 书的身份字段（id/title/status/updatedAt）来自产品库记录，与 book.json 内容无关；
			// 信任检查（resolveTrustedBookRoot）与访问控制（canAccessBinding）保持不变，
			// 因此降级条目不获得可信根，也不放宽任何工作区或叙述者访问。
			const config = root
				? (await readBookConfig(root, operation.bookId).catch(() => null)) ?? {}
				: {};
			results.push(this.mapBook(operation, config));
		}
		return results;
	}

	async deleteBook(bookId: string, actor: ProductActor): Promise<void> {
		const normalizedBookId = normalizeBookId(bookId);
		const operation = await this.getOperation(normalizedBookId, actor);
		if (operation.state !== "ready" || !operation.runtimeProjectId) {
			throw new ValidationError("Only a ready product book can be deleted");
		}

		const binding = await bookRuntimeBindingService.getByBookId(normalizedBookId);
		if (
			!binding ||
			binding.runtimeProjectId !== operation.runtimeProjectId ||
			!ownsBookBinding(actor, binding.createdByUserId)
		) {
			throw new NotFoundError("Book", normalizedBookId);
		}
		// 要不要删目录只看物理位置，不看建书输入记录、也不看请求参数：
		// 书根经 realpath 后是受控书籍根的直接子目录才算 NovelFork 自己管理的目录。
		// 外部根照旧要求服务端写入的可信标记；目录已不可解析（被移走、删掉）时只解绑不删目录，
		// 不再让删除卡在「目录无法解析」上。
		const diagnosis = await diagnoseTrustedBookRoot(binding, getControlledBooksRoot(), true);
		const ownedBookRoot =
			diagnosis.reason === "trusted" && (await isProductOwnedBookRoot(diagnosis.bookRoot))
				? diagnosis.bookRoot
				: null;

		// 顺序保证可重入：每一步失败时，之前的步骤都可以安全地再做一遍，
		// 绑定与建书记录留到最后删，所以再点一次删除能把剩下的步骤做完。
		// 1. Runtime 项目先删：Runtime 拒绝（如无法核实资源保护）时什么都还没改；
		//    在 Windows 上它的 watcher/git 进程还会占着书目录，先删项目才能删目录。
		//    上一次删除已删掉项目时跳过。
		//    删之前先让 Runtime 的 git 核实能通过：受控目录补做 git 初始化，外部非仓库目录只把 gitPath 置空。
		const runtimeProject = await runtimeDb.query.projects.findFirst({
			where: eq(projects.id, operation.runtimeProjectId),
			columns: { id: true, gitPath: true },
		});
		if (runtimeProject) {
			await prepareRuntimeProjectGitPath(runtimeProject, ownedBookRoot, operation.actorUserId);
			await deleteRuntimeProjectExplained(operation.runtimeProjectId);
		}
		// 2. 产品库里这本书的全部数据（单事务；失败时绑定与记录都还在，可重试）。
		purgeBookScopedStorage(getStorageDatabase(), normalizedBookId);
		// 3. 只删 NovelFork 自己管理的目录；外部目录只解绑。
		if (ownedBookRoot) await rm(ownedBookRoot, { recursive: true, force: true });
		// 4. 最后删绑定与建书记录。
		await bookRuntimeBindingService.deleteByProjectId(operation.runtimeProjectId);
		await productDb().delete(bookProvisionOperations).where(eq(bookProvisionOperations.id, operation.id));
		this.invalidateWorkspaceFileTree(normalizedBookId);
	}

	async listBoundNarrators(actor: ProductActor): Promise<ProductNarratorSummary[]> {
		const operations = await productDb().query.bookProvisionOperations.findMany({
			where: eq(bookProvisionOperations.state, READY_STATE),
			columns: { bookId: true },
		});
		const lists = await Promise.all(
			operations.map(async ({ bookId }) => {
				try {
					return await this.listBookNarrators(bookId, actor);
				} catch {
					// Bootstrap is a best-effort catalog. A stale or inaccessible binding
					// must not make other owned books disappear from the shell.
					return [];
				}
			}),
		);
		return lists.flat();
	}

	async listBookNarrators(
		bookId: string,
		actor: ProductActor,
	): Promise<ProductNarratorSummary[]> {
		const { operation } = await this.getReadyBookRoot(bookId, actor);
		if (!operation.runtimeChapterId) return [];
		const rows = await runtimeDb.query.narrators.findMany({
			where: eq(narrators.chapterId, operation.runtimeChapterId),
			columns: productNarratorColumns,
			orderBy: [desc(narrators.updatedAt), desc(narrators.createdAt)],
		});
		const productRows = rows.filter(
			(row) =>
				row.id === operation.narratorId ||
				(Array.isArray(row.traits) && row.traits.includes("novelfork-product")),
		);
		await Promise.all(
			productRows.map((row) => this.ensureProductNarratorWriteMode(row.id)),
		);
		return productRows.map((row) => this.mapNarrator(row, operation.bookId));
	}

	async getBoundNarrator(
		bookId: string,
		narratorId: string,
		actor: ProductActor,
	): Promise<ProductNarratorSummary> {
		const narrator = (await this.listBookNarrators(bookId, actor)).find(
			(candidate) => candidate.id === narratorId,
		);
		if (!narrator) throw new NotFoundError("Narrator", narratorId);
		return narrator;
	}

	async createBookNarrator(
		bookId: string,
		actor: ProductActor,
		rawTitle: string,
	): Promise<ProductNarratorSummary> {
		const title = rawTitle.trim();
		if (!title || title.length > 200) {
			throw new ValidationError("Narrator title must be between 1 and 200 characters");
		}
		const { operation, root } = await this.getReadyBookRoot(bookId, actor);
		if (!operation.runtimeChapterId || !operation.narratorId) {
			throw new ValidationError("Book has no ready narrator binding");
		}
		await this.ensureProductNarratorWriteMode(operation.narratorId);
		const source = await runtimeDb.query.narrators.findFirst({
			where: and(
				eq(narrators.id, operation.narratorId),
				eq(narrators.chapterId, operation.runtimeChapterId),
			),
			columns: {
				model: true,
				reasoningEffort: true,
			},
		});
		if (!source) throw new NotFoundError("Narrator", operation.narratorId);

		const timestamp = now();
		const [narrator] = await runtimeDb
			.insert(narrators)
			.values({
				id: generateId(),
				chapterId: operation.runtimeChapterId,
				type: "primary",
				variant: "primary",
				inheritMode: "fresh",
				title,
				model: source.model ?? getProductNarratorModel(),
				reasoningEffort: source.reasoningEffort,
				systemPrompt: NOVELIST_PROMPT,
				permissionMode: "default",
				status: "idle",
				cwd: root,
				traits: ["novelfork-product", "novelist", "chapter-write"],
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.returning();
		if (!narrator) throw new ValidationError("Failed to create book narrator");
		return this.mapNarrator(narrator, operation.bookId);
	}

	async create(actor: ProductActor, idempotencyKey: string, rawInput: ProductBookInput) {
		const key = idempotencyKey.trim();
		if (!key || key.length > 200) throw new ValidationError("Idempotency-Key header is required");
		const input = normalizeInput(rawInput);
		const existing = await productDb().query.bookProvisionOperations.findFirst({
			where: and(
				eq(bookProvisionOperations.actorUserId, actor.userId),
				eq(bookProvisionOperations.idempotencyKey, key),
			),
		});
		if (existing) return this.resume(existing, actor);
		await assertNewWorkspaceIsNotABook(input);

		const bookId = input.bookId ?? generatedBookId(input.title);
		const alreadyReserved = await productDb().query.bookProvisionOperations.findFirst({
			where: eq(bookProvisionOperations.bookId, bookId),
			columns: { id: true },
		});
		if (alreadyReserved)
			throw new ValidationError("A provision operation already exists for this bookId");
		// 受控根下同名目录已经存在（多半是没有建书记录的旧书）：建书不能沿用它，否则谁带上这个
		// bookId 谁就把别人的书收进自己的书架。没有绑定的旧书只能由管理员走 claim 认领。
		// 必须在写建书记录、Runtime 项目之前拒绝，不留半成品；promoteFilesystem 另有兜底。
		if (!isExternalBookWorkspace(input.projectInit)) {
			const controlledRoot = await realpath(getControlledBooksRoot()).catch(() => null);
			const targetRoot = controlledRoot ? deriveBookRoot(controlledRoot, bookId) : null;
			if (targetRoot && (await pathExists(targetRoot))) {
				throw controlledBookRootOccupiedError(
					bookId,
					await pathExists(join(targetRoot, "book.json")),
					actor.role === "admin",
				);
			}
		}

		const operation: ProvisionOperation = {
			id: generateId(),
			actorUserId: actor.userId,
			idempotencyKey: key,
			bookId,
			title: input.title,
			// provisionOrigin 只由服务端写入（路由的请求体校验是 strict，客户端带不进来），
			// promoteFilesystem 据此只对「建书」发起的记录收紧已存在目录的沿用条件。
			inputJson: { ...input, provisionOrigin: "create" },
			state: "reserved",
			runtimeProjectId: null,
			runtimeChapterId: null,
			narratorId: null,
			errorMessage: null,
			createdAt: now(),
			updatedAt: now(),
		};
		try {
			await productDb().insert(bookProvisionOperations).values(operation);
		} catch (error) {
			// A concurrent request can win the idempotency unique index between the
			// read above and insert. Return its durable operation rather than double-create.
			const raced = await productDb().query.bookProvisionOperations.findFirst({
				where: and(
					eq(bookProvisionOperations.actorUserId, actor.userId),
					eq(bookProvisionOperations.idempotencyKey, key),
				),
			});
			if (raced) return this.resume(raced, actor);
			throw error;
		}
		return this.resume(operation, actor);
	}

	async importExisting(
		actor: ProductActor,
		idempotencyKey: string,
		rawInput: ProductBookImportInput,
	) {
		const key = idempotencyKey.trim();
		const sourcePath = expandWorkspacePath(rawInput.sourcePath);
		if (!key || key.length > 200) throw new ValidationError("Idempotency-Key header is required");
		const existingOperation = await productDb().query.bookProvisionOperations.findFirst({
			where: and(
				eq(bookProvisionOperations.actorUserId, actor.userId),
				eq(bookProvisionOperations.idempotencyKey, key),
			),
		});
		if (existingOperation) return publicOperation(await this.resume(existingOperation, actor));
		if (!sourcePath) throw new ValidationError("sourcePath is required");
		const sourceRoot = await realpath(sourcePath).catch(() => {
			throw new ValidationError("所选作品目录不存在或无法读取");
		});
		const sourceStat = await stat(sourceRoot).catch(() => null);
		if (!sourceStat?.isDirectory()) throw new ValidationError("所选路径不是目录");
		// T-03②：源目录与任一已绑定书根重叠（相等、源在书内、或源包住书，cp 整目录会把书一起带走）时，
		// 只允许该书的属主（或管理员）导入。对非属主返回与「路径不存在」完全相同的错误：不泄露书 id，
		// 也不让调用方区分「目录不存在」与「目录属于他人」。
		const overlapping = await bookRuntimeBindingService.listBindingRootsOverlapping(sourceRoot);
		const foreign = overlapping.some((binding) => !ownsBookBinding(actor, binding.createdByUserId));
		if (foreign) throw new ValidationError("所选作品目录不存在或无法读取");
		const controlledRoot = resolve(getControlledBooksRoot());
		const relativeToControlled = relative(controlledRoot, sourceRoot);
		if (!relativeToControlled.startsWith("..") && !isAbsolute(relativeToControlled)) {
			throw new ValidationError("不能从受控作品目录重复导入");
		}
		await assertNoSymbolicLinks(sourceRoot);
		const sourceConfig = await readImportBookConfig(sourceRoot);
		const bookId = rawInput.bookId
			? normalizeBookId(rawInput.bookId)
			: typeof sourceConfig.id === "string" && sourceConfig.id.trim()
				? normalizeBookId(sourceConfig.id)
				: generatedBookId(String(sourceConfig.title));
		const existing = await productDb().query.bookProvisionOperations.findFirst({
			where: eq(bookProvisionOperations.bookId, bookId),
		});
		if (existing) throw new ValidationError("目标作品已经存在，请使用现有作品的修复操作");
		const targetRoot = resolve(getControlledBooksRoot(), bookId);
		if (await pathExists(targetRoot)) throw new ValidationError("目标作品目录已经存在");
		const stagingRoot = join(getControlledBooksRoot(), `.import-${bookId}-${randomUUID()}`);
		try {
			await cp(sourceRoot, stagingRoot, { recursive: true, errorOnExist: true, force: false });
			const importedConfig = { ...sourceConfig, id: bookId, updatedAt: now() };
			await writeFile(
				join(stagingRoot, "book.json"),
				`${JSON.stringify(importedConfig, null, 2)}\n`,
				"utf8",
			);
			await mkdir(join(stagingRoot, "chapters"), { recursive: true });
			if (!(await pathExists(join(stagingRoot, "chapters", "index.json"))))
				await writeFile(join(stagingRoot, "chapters", "index.json"), "[]\n", "utf8");
			await rename(stagingRoot, targetRoot);
		} catch (error) {
			await rm(stagingRoot, { recursive: true, force: true });
			throw error;
		}
		const timestamp = now();
		const operation: ProvisionOperation = {
			id: generateId(),
			actorUserId: actor.userId,
			idempotencyKey: key,
			bookId,
			title: String(sourceConfig.title),
			inputJson: {
				bookId,
				title: String(sourceConfig.title),
				genre: typeof sourceConfig.genre === "string" ? sourceConfig.genre : undefined,
				language: sourceConfig.language === "en" ? "en" : "zh",
				platform: ["tomato", "feilu", "qidian"].includes(String(sourceConfig.platform))
					? sourceConfig.platform
					: "other",
			},
			state: "reserved",
			runtimeProjectId: null,
			runtimeChapterId: null,
			narratorId: null,
			errorMessage: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		await productDb().insert(bookProvisionOperations).values(operation);
		await this.stageCore(operation);
		let current = await this.updateOperation(operation.id, { state: "core-staged" });
		await syncImportedChapters(bookId, targetRoot);
		current = await this.updateOperation(operation.id, { state: "filesystem-promoted" });
		return publicOperation(await this.resume(current, actor));
	}

	/**
	 * 从项目档案导入为新书（不覆盖任何已有作品）。
	 *
	 * 顺序：校验档案（无副作用）→ 生成新 bookId → 文件写暂存目录 + 数据单事务入库 →
	 * 暂存目录转正为受控作品目录 → 登记建书流程并完成 Runtime 绑定。
	 * 数据入库之后任何一步失败都走补偿：撤掉 Runtime 项目与绑定、删掉流程记录、清掉导入的数据与目录，
	 * 不留半本书。
	 */
	async importBookArchive(
		actor: ProductActor,
		idempotencyKey: string,
		bytes: Uint8Array,
		modules?: readonly BookArchiveModuleId[],
	): Promise<{ operation: ReturnType<typeof publicOperation>; report: BookArchiveImportReport | null }> {
		const key = idempotencyKey.trim();
		if (!key || key.length > 200) throw new ValidationError("Idempotency-Key header is required");
		const existingOperation = await productDb().query.bookProvisionOperations.findFirst({
			where: and(
				eq(bookProvisionOperations.actorUserId, actor.userId),
				eq(bookProvisionOperations.idempotencyKey, key),
			),
		});
		// 同一次提交重复到达：返回已有结果，不再导入第二本。
		if (existingOperation) return { operation: publicOperation(await this.resume(existingOperation, actor)), report: null };

		const archive = readBookArchive(bytes);
		const sourceConfig = (() => {
			const file = archive.files.find((candidate) => candidate.path === "book.json");
			try {
				const parsed = JSON.parse(Buffer.from(file?.data ?? new Uint8Array()).toString("utf8")) as unknown;
				return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
			} catch {
				return {};
			}
		})();
		const title = archive.manifest.source.title.trim().slice(0, 200) || "导入的作品";
		const bookId = generatedBookId(title);
		if (await productDb().query.bookProvisionOperations.findFirst({ where: eq(bookProvisionOperations.bookId, bookId), columns: { id: true } })) {
			throw new BookArchiveError("book-id-conflict", "为导入生成的作品 ID 恰好与已有作品重复，请再导入一次。");
		}
		const targetRoot = await this.controlledBookRoot(bookId, true);
		if (await pathExists(targetRoot)) {
			throw new BookArchiveError("book-root-conflict", "为导入生成的作品目录已经存在，请再导入一次。");
		}
		const stagingRoot = join(dirname(targetRoot), `.archive-import-${randomUUID()}`);
		const storage = getStorageDatabase();
		const report = await importBookArchiveIntoStorage({
			storage,
			archive,
			newBookId: bookId,
			stagingRoot,
			...(modules && modules.length > 0 ? { modules } : {}),
			// 导入后的作品一律落在受控目录里；源机器的外部 workspace 标记不再成立。
			transformBookConfig: (config) => {
				const next = { ...config };
				delete next[EXTERNAL_BOOK_WORKSPACE_MARKER];
				return next;
			},
		});

		let operationId: string | null = null;
		try {
			await rename(stagingRoot, targetRoot);
			const timestamp = now();
			const chapterWordCount = Number(sourceConfig.chapterWordCount);
			const operation: ProvisionOperation = {
				id: generateId(),
				actorUserId: actor.userId,
				idempotencyKey: key,
				bookId,
				title,
				inputJson: {
					bookId,
					title,
					genre: typeof sourceConfig.genre === "string" ? sourceConfig.genre : undefined,
					language: sourceConfig.language === "en" ? "en" : "zh",
					platform: ["tomato", "feilu", "qidian"].includes(String(sourceConfig.platform)) ? sourceConfig.platform : "other",
					...(Number.isInteger(chapterWordCount) && chapterWordCount >= 500 ? { chapterWordCount } : {}),
					projectInit: { source: "none", managedByNovelFork: true },
				},
				// 书籍行与目录都已就位，直接从 Runtime 绑定这一步继续。
				state: "filesystem-promoted",
				runtimeProjectId: null,
				runtimeChapterId: null,
				narratorId: null,
				errorMessage: null,
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			await productDb().insert(bookProvisionOperations).values(operation);
			operationId = operation.id;
			const current = await this.resume(operation, actor);
			if (operationState(current) !== READY_STATE) {
				throw new Error(current.errorMessage ?? `Runtime 绑定停在 ${current.state}`);
			}
			this.invalidateWorkspaceFileTree(bookId);
			return { operation: publicOperation(current), report };
		} catch (error) {
			await this.compensateArchiveImport(bookId, operationId, stagingRoot, targetRoot);
			const detail = error instanceof Error ? error.message : String(error);
			throw new BookArchiveError(
				"runtime-bind-failed",
				`数据已通过校验，但新书没能完成目录转正或 Runtime 绑定，已撤销本次导入，没有留下半本书（${detail}）。请在「我的作品」里确认 Runtime 正常后重试。`,
			);
		}
	}

	/** 档案导入的补偿：逐项撤销，单项失败不影响其余清理。 */
	private async compensateArchiveImport(
		bookId: string,
		operationId: string | null,
		stagingRoot: string,
		targetRoot: string,
	): Promise<void> {
		const operation = operationId
			? await productDb().query.bookProvisionOperations.findFirst({ where: eq(bookProvisionOperations.id, operationId) }).catch(() => undefined)
			: undefined;
		if (operation?.runtimeProjectId) {
			await deleteProjectById(operation.runtimeProjectId).catch(() => undefined);
			await bookRuntimeBindingService.deleteByProjectId(operation.runtimeProjectId).catch(() => false);
		}
		if (operationId) {
			await productDb().delete(bookProvisionOperations).where(eq(bookProvisionOperations.id, operationId)).catch(() => undefined);
		}
		try {
			purgeBookArchiveData(getStorageDatabase(), bookId);
		} catch {
			// 数据库不可用时无法清理；目录仍会删除，残留行在报告里无从体现，只能交给修复流程。
		}
		await rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
		await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
		this.invalidateWorkspaceFileTree(bookId);
	}

	async getOperation(bookId: string, actor: ProductActor): Promise<ProvisionOperation> {
		const operation = await productDb().query.bookProvisionOperations.findFirst({
			where: eq(bookProvisionOperations.bookId, normalizeBookId(bookId)),
		});
		if (!operation) throw new NotFoundError("Book provision operation", bookId);
		if (operation.actorUserId !== actor.userId && actor.role !== "admin") {
			throw new NotFoundError("Book provision operation", bookId);
		}
		return operation;
	}

	async status(bookId: string, actor: ProductActor) {
		return publicOperation(await this.getOperation(bookId, actor));
	}

	async retry(bookId: string, actor: ProductActor) {
		const operation = await this.getOperation(bookId, actor);
		if (operationState(operation) === "ready") return publicOperation(operation);
		return publicOperation(await this.resume(operation, actor));
	}

	/** Legacy controlled-root books may only be claimed by an administrator. */
	async claim(bookId: string, actor: ProductActor) {
		const normalizedBookId = normalizeBookId(bookId);
		const binding = await bookRuntimeBindingService.getByBookId(normalizedBookId);
		if (binding) {
			if (!this.canAccessBinding(actor, binding)) throw new NotFoundError("Book", normalizedBookId);
			return this.repair(normalizedBookId, actor);
		}
		if (actor.role !== "admin")
			throw new ValidationError("Only an administrator can claim an unbound legacy book");
		const existing = await productDb().query.bookProvisionOperations.findFirst({
			where: eq(bookProvisionOperations.bookId, normalizedBookId),
		});
		if (existing) return publicOperation(await this.resume(existing, actor));

		const root = await this.controlledBookRoot(normalizedBookId, false);
		const config = await readBookConfig(root, normalizedBookId);
		const timestamp = now();
		const operation: ProvisionOperation = {
			id: generateId(),
			actorUserId: actor.userId,
			idempotencyKey: `admin-claim:${normalizedBookId}:${randomUUID()}`,
			bookId: normalizedBookId,
			title: config.title as string,
			inputJson: {
				bookId: normalizedBookId,
				title: config.title as string,
				genre: typeof config.genre === "string" ? config.genre : undefined,
				language:
					config.language === "en" || config.language === "zh" ? config.language : undefined,
				platform:
					config.platform === "tomato" ||
					config.platform === "feilu" ||
					config.platform === "qidian"
						? config.platform
						: "other",
			},
			state: "filesystem-promoted",
			runtimeProjectId: null,
			runtimeChapterId: null,
			narratorId: null,
			errorMessage: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		await productDb().insert(bookProvisionOperations).values(operation);
		return publicOperation(await this.resume(operation, actor));
	}

	async repair(bookId: string, actor: ProductActor) {
		const normalizedBookId = normalizeBookId(bookId);
		const binding = await bookRuntimeBindingService.getByBookId(normalizedBookId);
		if (binding && !this.canAccessBinding(actor, binding))
			throw new NotFoundError("Book", normalizedBookId);
		let operation = await productDb().query.bookProvisionOperations.findFirst({
			where: eq(bookProvisionOperations.bookId, normalizedBookId),
		});
		if (!operation) {
			if (!binding) throw new NotFoundError("Book provision operation", normalizedBookId);
			operation = await this.reserveRecoveredBindingOperation(normalizedBookId, binding, actor);
		}
		if (operation.actorUserId !== actor.userId && actor.role !== "admin") {
			throw new NotFoundError("Book provision operation", normalizedBookId);
		}
		return publicOperation(await this.resume(operation, actor));
	}

	/**
	 * Manually correct a book's trusted workspace root after migration or a bad
	 * binding. Updates book_runtime_bindings.book_root, Runtime project/chapter
	 * paths, and marks the book.json as an external workspace.
	 */
	async rebindWorkspace(
		bookId: string,
		actor: ProductActor,
		workspaceRoot: string,
	): Promise<{ bookId: string; bookRoot: string; runtimeProjectId: string }> {
		const normalizedBookId = normalizeBookId(bookId);
		const rawRoot = expandWorkspacePath(workspaceRoot);
		if (!rawRoot || !isAbsolute(rawRoot)) {
			throw new ValidationError("workspaceRoot must be an absolute path");
		}
		const operation = await this.getOperation(normalizedBookId, actor);
		if (operation.state !== "ready" || !operation.runtimeProjectId) {
			throw new ValidationError("Only a ready product book can rebind its workspace");
		}
		const binding = await bookRuntimeBindingService.getByBookId(normalizedBookId);
		if (
			!binding ||
			binding.runtimeProjectId !== operation.runtimeProjectId ||
			!ownsBookBinding(actor, binding.createdByUserId)
		) {
			throw new NotFoundError("Book", normalizedBookId);
		}

		const root = await realpath(rawRoot).catch(() => {
			throw new ValidationError("workspaceRoot does not exist");
		});
		const rootInfo = await stat(root).catch(() => null);
		if (!rootInfo?.isDirectory()) {
			throw new ValidationError("workspaceRoot must be an existing directory");
		}

		// Accept either a matching book.json or a directory that can be read as
		// an imported book. Never silently invent a new identity.
		const config = await readBookConfig(root, normalizedBookId).catch(async () => {
			const imported = await readImportBookConfig(root);
			if (typeof imported.id === "string" && imported.id.trim() && imported.id.trim() !== normalizedBookId) {
				throw new ValidationError(
					`workspaceRoot book id "${imported.id}" does not match "${normalizedBookId}"`,
				);
			}
			return imported;
		});
		if (typeof config.id === "string" && config.id.trim() && config.id.trim() !== normalizedBookId) {
			throw new ValidationError(
				`workspaceRoot book id "${config.id}" does not match "${normalizedBookId}"`,
			);
		}

		// Persist the external marker so resolveTrustedBookRoot continues to honor
		// this absolute path after the binding is rewritten.
		// 读改写放在 book.json 按书锁里，锁内重读，不与其他写入方交错。
		await withBookConfigLock(root, async () => {
			const existingRaw = await readFile(join(root, "book.json"), "utf8").catch(() => null);
			const existingConfig: Record<string, unknown> | null = existingRaw
				? (() => {
						try {
							return JSON.parse(existingRaw) as Record<string, unknown>;
						} catch {
							return null;
						}
					})()
				: null;
			const nextConfig: Record<string, unknown> = {
				...(existingConfig && typeof existingConfig === "object" ? existingConfig : config),
				id: normalizedBookId,
				title:
					(typeof existingConfig?.title === "string" && existingConfig.title) ||
					(typeof config.title === "string" && config.title) ||
					operation.title,
				[EXTERNAL_BOOK_WORKSPACE_MARKER]: true,
				updatedAt: now(),
			};
			await writeFileAtomic(join(root, "book.json"), `${JSON.stringify(nextConfig, null, 2)}\n`);
		});

		const updatedBinding = await bookRuntimeBindingService.upsert(
			operation.runtimeProjectId,
			normalizedBookId,
			binding.createdByUserId,
			root,
		);

		const timestamp = now();
		await runtimeDb
			.update(projects)
			.set({ gitPath: root, updatedAt: timestamp })
			.where(eq(projects.id, operation.runtimeProjectId));
		if (operation.runtimeChapterId) {
			await runtimeDb
				.update(chapters)
				.set({ worktreePath: root, updatedAt: timestamp })
				.where(eq(chapters.id, operation.runtimeChapterId));
		}
		if (operation.narratorId) {
			await runtimeDb
				.update(narrators)
				.set({ cwd: root, updatedAt: timestamp })
				.where(eq(narrators.id, operation.narratorId));
		}

		// 同步建书输入，书架与工作区读取据此按外部目录解析可信根。
		// 删书是否删除目录不看这份记录，只看物理位置（见 deleteBook）。
		const input = operation.inputJson as ProductBookInput;
		await this.updateOperation(operation.id, {
			inputJson: {
				...input,
				projectInit: {
					source: "existing",
					workspaceRoot: root,
					managedByNovelFork: false,
				},
			},
			errorMessage: null,
		});
		this.invalidateWorkspaceFileTree(normalizedBookId);

		return {
			bookId: normalizedBookId,
			bookRoot: updatedBinding.bookRoot,
			runtimeProjectId: operation.runtimeProjectId,
		};
	}

	async getReadOnlyResources(bookId: string, actor: ProductActor) {
		const { config, root } = await this.getReadyBookRoot(bookId, actor);
		const writingResources = await createDomainWritingResourceService(bookId, root).list(bookId, {
			type: "chapter",
			status: "accepted",
		});
		return {
			book: config,
			chapters: writingResources.map((resource) => ({
				number: resource.chapterNumber,
				title: resource.title,
				status: "approved",
				wordCount: resource.wordCount,
				createdAt: new Date(resource.createdAt).toISOString(),
				updatedAt: new Date(resource.updatedAt).toISOString(),
				auditIssues: [],
				lengthWarnings: [],
			})),
		};
	}

	/** Server-only context for book-scoped configuration adapters. */
	async getTrustedBookConfiguration(bookId: string, actor: ProductActor): Promise<{
		root: string;
		config: Record<string, unknown>;
	}> {
		const { root, config } = await this.getReadyBookRoot(bookId, actor);
		return { root, config };
	}

	/**
	 * Apply only the book-settings fields exposed by the product UI. This keeps
	 * binding metadata, external-workspace markers, presets, beats and Narrative
	 * Memory configuration intact rather than accepting a browser-supplied book.json.
	 */
	async updateBasicSettings(
		bookId: string,
		patch: ProductBookBasicSettingsPatch,
		actor: ProductActor,
	): Promise<Record<string, unknown>> {
		const { operation, root } = await this.getReadyBookRoot(bookId, actor);
		// 锁内重读最新 book.json 再套用补丁，不用请求开始时读到的旧配置整份写回。
		const nextConfig = (await updateBookConfigExplained(root, (current) => {
			const next: Record<string, unknown> = {
				...current,
				...patch,
				updatedAt: now(),
			};
			if (patch.targetChapters === null) delete next.targetChapters;
			if (patch.foreshadowDebtThresholds === null) delete next.foreshadowDebtThresholds;
			const nextTitle = typeof next.title === "string" ? next.title.trim() : "";
			if (!nextTitle) throw new ValidationError("Book title must not be empty");
			next.title = nextTitle;
			return next;
		})) as Record<string, unknown>;
		const title = nextConfig.title as string;

		const input = operation.inputJson as ProductBookInput;
		const nextInput: ProductBookInput = {
			...input,
			title,
			...(patch.genre !== undefined ? { genre: patch.genre } : {}),
			...(patch.language !== undefined ? { language: patch.language } : {}),
			...(patch.platform !== undefined ? { platform: patch.platform } : {}),
			...(patch.chapterWordCount !== undefined ? { chapterWordCount: patch.chapterWordCount } : {}),
			...(typeof patch.targetChapters === "number" ? { targetChapters: patch.targetChapters } : {}),
		};
		if (patch.targetChapters === null) delete nextInput.targetChapters;
		await this.updateOperation(operation.id, { title, inputJson: nextInput });

		// The core catalog is a derived index. Keep its visible name fresh when
		// available, but never roll back a successful trusted filesystem update if
		// a gateway-only Runtime has not initialized that database.
		try {
			const repository = createBookRepository(getStorageDatabase());
			await repository.update(bookId, { name: title, updatedAt: new Date() });
		} catch {
			// Best effort only; the product binding and book.json remain authoritative.
		}
		this.invalidateWorkspaceFileTree(operation.bookId);
		return nextConfig;
	}

	/**
	 * Shared authorization gate for NovelFork domain HTTP routes. The caller only
	 * receives success/failure; the trusted filesystem root never crosses the
	 * product boundary.
	 */
	async assertReadyBookAccess(bookId: string, actor: ProductActor): Promise<void> {
		await this.getReadyBookRoot(bookId, actor);
	}

	/**
	 * Apply NewBookGuide answers: update book.json metadata and seed jingwei entries.
	 * This endpoint was lost when Studio server was retired; the frontend still posts here.
	 */
	async applyGuidedSetup(
		bookId: string,
		input: GuidedSetupInput,
		actor: ProductActor,
	): Promise<GuidedSetupResult> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const answers = normalizeGuidedSetupAnswers(input.answers);
		const aiTaste = guidedAnswerText(answers.aiTasteLevel);
		const writingPhilosophy = guidedAnswerText(answers.writingPhilosophy);
		const tone = guidedAnswerText(answers.tone);

		// 锁内重读最新 book.json，答案缺省的字段沿用锁内读到的当前值。
		const nextConfig = (await updateBookConfigExplained(root, (config) => {
			const genre = guidedAnswerText(answers.genre) ?? String(config.genre ?? "未分类");
			const chapterWordCount =
				parseGuidedChapterWordCount(guidedAnswerText(answers.chapterWordCount)) ??
				(typeof config.chapterWordCount === "number" ? config.chapterWordCount : 3000);
			const platform = mapGuidedPlatform(guidedAnswerText(answers.platform)) ??
				(typeof config.platform === "string" ? config.platform : "other");
			const next: Record<string, unknown> = {
				...config,
				genre,
				platform,
				chapterWordCount,
				complexity: getGenreTemplate(genre).complexity,
				status: config.status === "incubating" ? "outlining" : config.status,
				updatedAt: now(),
			};
			if (aiTaste) next.aiTasteLevel = aiTaste;
			if (writingPhilosophy) next.writingPhilosophy = writingPhilosophy;
			if (tone) next.tone = tone;
			return next;
		})) as Record<string, unknown>;
		const genre = nextConfig.genre as string;
		const platform = nextConfig.platform as string;
		const template = getGenreTemplate(genre);

		// Best-effort story notes so the workbench has human-readable seeds even when
		// SQLite jingwei is empty or later re-imported.
		await appendGuidedStoryNotes(root, answers).catch(() => undefined);

		const storage = getStorageDatabase();
		const { created } = await createJingweiEntriesFromGuide(
			bookId,
			answers as GuidedSetupAnswers,
			template,
			storage,
		);

		// 按答案挑 Writing Skills 建议。这里刻意不写项目 Skill 文件：
		// 每个添加的 Skill 都会持续影响后续每一章的生成，需作者确认后再由
		// 作者在写作台「技能文风」勾选后同步到 `.novelfork/skills`。
		const recommendation = await this.recommendWritingSkillsForGuidedSetup({
			genre,
			platform,
			complexity: template.complexity,
			...(tone ? { tone } : {}),
			...(aiTaste ? { aiTasteLevel: aiTaste } : {}),
			...(writingPhilosophy ? { writingPhilosophy } : {}),
		});
		this.invalidateWorkspaceFileTree(normalizeBookId(bookId));

		return {
			ok: true,
			bookId,
			createdEntries: created,
			genre,
			complexity: template.complexity,
			recommendedWritingSkills: recommendation.recommended.map((item) => ({
				id: item.id,
				slug: item.slug,
				name: item.name,
				kind: item.kind,
				reason: item.reason,
			})),
			matchedGenreCluster: recommendation.matchedGenreCluster,
		};
	}

	/**
	 * 加载内置 Writing Skills 并按建书答案给出建议。
	 *
	 * 推荐失败不应让建书失败：十一问的主产物是 book.json 与经纬条目，
	 * 拿不到建议时返回空清单，作者仍可在写作设置里手动挑。
	 */
	private async recommendWritingSkillsForGuidedSetup(
		input: WritingSkillRecommendationInput,
	): Promise<WritingSkillRecommendation> {
		try {
			return recommendWritingSkills(input, await loadWritingSkills());
		} catch {
			return {
				recommended: [],
				consideredCount: 0,
				droppedByConflict: [],
				matchedGenreCluster: null,
			};
		}
	}

	private workspaceFileTreeGeneration(bookId: string): number {
		return this.workspaceFileTreeGenerations.get(bookId) ?? 0;
	}

	private workspaceFileTreeKey(
		bookId: string,
		root: string,
		depth: number,
		generation: number,
	): string {
		return `${bookId}\u0000${root}\u0000${depth}\u0000${generation}`;
	}

	private invalidateWorkspaceFileTree(bookId: string): void {
		this.workspaceFileTreeGenerations.set(bookId, this.workspaceFileTreeGeneration(bookId) + 1);
		for (const [key, snapshot] of this.workspaceFileTreeCache) {
			if (snapshot.bookId === bookId) this.workspaceFileTreeCache.delete(key);
		}
	}

	private cacheWorkspaceFileTree(key: string, snapshot: WorkspaceFileTreeSnapshot): void {
		this.workspaceFileTreeCache.delete(key);
		this.workspaceFileTreeCache.set(key, snapshot);
		while (this.workspaceFileTreeCache.size > MAX_WORKSPACE_FILE_TREE_CACHE_ENTRIES) {
			const oldestKey = this.workspaceFileTreeCache.keys().next().value;
			if (typeof oldestKey !== "string") break;
			this.workspaceFileTreeCache.delete(oldestKey);
		}
	}

	private async scanWorkspaceFileTree(
		root: string,
		maxDepth: number,
	): Promise<ProductWorkspaceFileEntry[]> {
		const walk = async (
			relativeDir: string,
			remainingDepth: number,
		): Promise<ProductWorkspaceFileEntry[]> => {
			const { absolutePath } = await resolveWorkspacePath(root, relativeDir, {
				allowRoot: true,
				requireExisting: true,
			});
			const entries = await readdir(absolutePath, { withFileTypes: true });
			const result: ProductWorkspaceFileEntry[] = [];
			for (const entry of entries.sort((left, right) =>
				left.name.localeCompare(right.name, "zh-CN")
			)) {
				if (entry.isSymbolicLink()) continue;
				const childPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
				// 受控书初始化为 git 仓库后书根多了 .git：不进文件树，免得暴露版本库内部、拖慢扫描。
				if (isWorkspaceGitPath(childPath)) continue;
				const child = await resolveWorkspacePath(root, childPath, { requireExisting: true }).catch(
					() => null,
				);
				if (!child) continue;
				const info = await stat(child.absolutePath).catch(() => null);
				if (!info) continue;
				if (entry.isDirectory() && info.isDirectory()) {
					result.push({
						name: entry.name,
						path: childPath,
						type: "directory",
						mtime: info.mtime.toISOString(),
						...(remainingDepth > 0
							? { children: await walk(childPath, remainingDepth - 1) }
							: {}),
					});
				} else if (entry.isFile() && info.isFile()) {
					result.push({
						name: entry.name,
						path: childPath,
						type: "file",
						size: info.size,
						mtime: info.mtime.toISOString(),
					});
				}
			}
			return result;
		};
		return walk("", maxDepth);
	}

	private getOrBuildWorkspaceFileTree(
		bookId: string,
		root: string,
		depth: number,
		generation: number,
		key: string,
	): Promise<WorkspaceFileTreeSnapshot> {
		const currentBuild = this.workspaceFileTreeBuilds.get(key);
		if (currentBuild) return currentBuild;

		const build = (async () => {
			const snapshot: WorkspaceFileTreeSnapshot = {
				bookId,
				root,
				depth,
				generation,
				tree: await this.scanWorkspaceFileTree(root, depth),
				generatedAt: Date.now(),
			};
			if (this.workspaceFileTreeGeneration(bookId) === generation) {
				this.cacheWorkspaceFileTree(key, snapshot);
			}
			return snapshot;
		})();
		this.workspaceFileTreeBuilds.set(key, build);
		const clearBuild = () => {
			if (this.workspaceFileTreeBuilds.get(key) === build) {
				this.workspaceFileTreeBuilds.delete(key);
			}
		};
		void build.then(clearBuild, clearBuild);
		return build;
	}

	async getWorkspaceFileTree(
		bookId: string,
		actor: ProductActor,
		depth = 8,
		options: { refresh?: boolean } = {},
	): Promise<ProductWorkspaceFileTreeResult> {
		const { root, operation } = await this.getReadyBookRoot(bookId, actor);
		const normalizedBookId = operation.bookId;
		const maxDepth = Math.max(0, Math.min(Math.floor(depth), MAX_WORKSPACE_TREE_DEPTH));
		const generation = this.workspaceFileTreeGeneration(normalizedBookId);
		const key = this.workspaceFileTreeKey(normalizedBookId, root, maxDepth, generation);
		const cached = this.workspaceFileTreeCache.get(key);

		if (!options.refresh && cached) {
			this.cacheWorkspaceFileTree(key, cached);
			const stale = Date.now() - cached.generatedAt >= WORKSPACE_FILE_TREE_CACHE_TTL_MS;
			if (stale) {
				void this.getOrBuildWorkspaceFileTree(
					normalizedBookId,
					root,
					maxDepth,
					generation,
					key,
				).catch(() => undefined);
			}
			return {
				root: cached.root,
				tree: cached.tree,
				cache: {
					hit: true,
					stale,
					refreshing: stale,
					generatedAt: new Date(cached.generatedAt).toISOString(),
				},
			};
		}

		const snapshot = await this.getOrBuildWorkspaceFileTree(
			normalizedBookId,
			root,
			maxDepth,
			generation,
			key,
		);
		return {
			root: snapshot.root,
			tree: snapshot.tree,
			cache: {
				hit: Boolean(cached),
				stale: false,
				refreshing: false,
				generatedAt: new Date(snapshot.generatedAt).toISOString(),
			},
		};
	}

	async readWorkspaceFile(bookId: string, rawPath: string, actor: ProductActor): Promise<{ path: string; content: string }> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const target = await resolveWorkspacePath(root, rawPath, { requireExisting: true });
		const info = await stat(target.absolutePath);
		if (!info.isFile()) throw new ValidationError("workspace path must identify a file");
		if (info.size > MAX_WORKSPACE_FILE_BYTES) {
			const sizeKb = Math.ceil(info.size / 1024);
			const limitKb = Math.floor(MAX_WORKSPACE_FILE_BYTES / 1024);
			throw new ValidationError([
				`发生了什么：文件约 ${sizeKb} KB，超过工作台打开上限 ${limitKb} KB。`,
				"为什么要看：直接加载会让 Markdown 编辑器建立过大的文档树，导致界面卡顿甚至无响应。",
				"建议怎么做：把设定拆成多个较小的 Markdown 文件，或先用外部编辑器处理后再回到工作台。",
			].join("\n"));
		}
		return { path: target.relativePath, content: await readFile(target.absolutePath, "utf8") };
	}

	/**
	 * IDE 文件网关写文件。`mode` 是调用方的显式意图：
	 * - `overwrite`（默认，编辑器保存）：覆盖已有文件；
	 * - `create`（文件树新建、复制粘贴）：目标已存在就以 409 拒绝，绝不清空或覆盖作者已有的文件。
	 * 写入走原子写：中断时目标只会是旧版或新版。
	 */
	async writeWorkspaceFile(
		bookId: string,
		rawPath: string,
		content: string,
		actor: ProductActor,
		mode: WorkspaceFileWriteMode = "overwrite",
	): Promise<{ path: string }> {
		const contentBytes = typeof content === "string" ? Buffer.byteLength(content, "utf8") : 0;
		if (typeof content !== "string" || contentBytes > MAX_WORKSPACE_FILE_BYTES) {
			const sizeKb = Math.ceil(contentBytes / 1024);
			const limitKb = Math.floor(MAX_WORKSPACE_FILE_BYTES / 1024);
			throw new ValidationError([
				`发生了什么：要保存的内容约 ${sizeKb} KB，超过工作台保存上限 ${limitKb} KB。`,
				"为什么要看：过大的单文件会拖慢编辑器和版本保存，继续写入也可能导致工作区响应变慢。",
				"建议怎么做：拆分文件后分别保存，或先在外部编辑器中整理。",
			].join("\n"));
		}
		const { root, operation, config } = await this.getReadyBookRoot(bookId, actor);
		const normalizedPath = normalizeWorkspacePath(rawPath);
		assertMutableWorkspacePath(normalizedPath);
		const target = await resolveWorkspacePath(root, normalizedPath, { requireExisting: false, allowMissingParents: true });
		const info = await stat(target.absolutePath).catch(() => null);
		if (info && !info.isFile()) throw new ValidationError("workspace path must identify a file");
		await mkdir(dirname(target.absolutePath), { recursive: true });
		if (mode === "create") {
			if (info) throw workspacePathExistsError(target.relativePath);
			// 先用独占新建（wx）占住文件名：并发的另一次新建会在这里拿到 EEXIST，而不是互相覆盖。
			try {
				await writeFile(target.absolutePath, "", { encoding: "utf8", flag: "wx" });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") throw workspacePathExistsError(target.relativePath);
				throw error;
			}
			if (content !== "") {
				try {
					await writeFileAtomic(target.absolutePath, content);
				} catch (error) {
					await rm(target.absolutePath, { force: true }).catch(() => undefined);
					throw error;
				}
			}
		} else {
			await writeFileAtomic(target.absolutePath, content);
		}
		this.invalidateWorkspaceFileTree(operation.bookId);
		// 文件网关直接写章节文件，不经过写作资源服务，立即对账补上附带动作。
		if (isChapterPath(target.relativePath)) {
			await this.reconcileBookChapters(operation.bookId, root, config);
		}
		return { path: target.relativePath };
	}

	async mkdirWorkspacePath(bookId: string, rawPath: string, actor: ProductActor): Promise<{ path: string }> {
		const { root, operation } = await this.getReadyBookRoot(bookId, actor);
		const target = await resolveWorkspacePath(root, rawPath, { requireExisting: false, allowMissingParents: true });
		if (isWorkspaceGitPath(target.relativePath)) assertMutableWorkspacePath(target.relativePath);
		if (await stat(target.absolutePath).catch(() => null)) throw new ValidationError("workspace path already exists");
		await mkdir(target.absolutePath, { recursive: true });
		this.invalidateWorkspaceFileTree(operation.bookId);
		return { path: target.relativePath };
	}

	async renameWorkspacePath(bookId: string, from: string, to: string, actor: ProductActor): Promise<{ from: string; to: string }> {
		const { root, operation } = await this.getReadyBookRoot(bookId, actor);
		const source = await resolveWorkspacePath(root, from, { requireExisting: true });
		const destinationPath = normalizeWorkspacePath(to);
		assertMutableWorkspacePath(source.relativePath);
		assertMutableWorkspacePath(destinationPath);
		const destination = await resolveWorkspacePath(root, destinationPath, { requireExisting: false });
		if (await stat(destination.absolutePath).catch(() => null)) throw new ValidationError("workspace destination already exists");
		await rename(source.absolutePath, destination.absolutePath);
		this.invalidateWorkspaceFileTree(operation.bookId);
		return { from: source.relativePath, to: destination.relativePath };
	}

	async deleteWorkspacePath(bookId: string, rawPath: string, actor: ProductActor): Promise<{ path: string }> {
		const { root, operation } = await this.getReadyBookRoot(bookId, actor);
		const target = await resolveWorkspacePath(root, rawPath, { requireExisting: true });
		assertMutableWorkspacePath(target.relativePath);
		await rm(target.absolutePath, { recursive: true, force: false });
		this.invalidateWorkspaceFileTree(operation.bookId);
		return { path: target.relativePath };
	}

	async getWorkspace(
		bookId: string,
		actor: ProductActor,
	): Promise<{
		book: ProductBookSummary;
		resources: ProductWorkspaceResource[];
		capabilities: RuntimeEntityCapabilities;
	}> {
		const { operation, root, config } = await this.getReadyBookRoot(bookId, actor);
		await this.reconcileBookChapters(operation.bookId, root, config);
		const resources = (
			await createDomainWritingResourceService(bookId, root, bookCountingMode(config)).list(bookId)
		).map(toWorkspaceWritingResource);
		const resourceIds = new Set(resources.map((resource) => resource.id));

		const addReadOnlyFile = async (
			baseRoot: string,
			id: string,
			kind: string,
			title: string,
			relativePath: string,
		): Promise<void> => {
			if (resourceIds.has(id)) return;
			const content = await readFile(join(baseRoot, relativePath), "utf8").catch(() => null);
			if (content === null) return;
			resourceIds.add(id);
			resources.push({
				id,
				kind,
				title,
				content,
				path: relativePath.replaceAll("\\", "/"),
				metadata: { bookId: operation.bookId },
				capabilities: { ...READ_ONLY_CAPABILITIES },
			});
		};

		await addReadOnlyFile(root, "book.json", "book-config", "book.json", "book.json");
		await addReadOnlyFile(
			root,
			"chapters/index.json",
			"chapter-index",
			"章节索引",
			join("chapters", "index.json"),
		);

		for (const resource of await listMarkdownResources(root, operation.bookId)) {
			if (resourceIds.has(resource.id)) continue;
			resourceIds.add(resource.id);
			resources.push(resource);
		}

		return {
			book: this.mapBook(operation, config),
			resources,
			capabilities: { ...WORKSPACE_CAPABILITIES },
		};
	}

	async saveWorkspaceResource(
		bookId: string,
		resourceId: string,
		content: string,
		actor: ProductActor,
	): Promise<{ resource: ProductWorkspaceResource }> {
		if (typeof content !== "string" || content.length > MAX_WORKSPACE_CONTENT_LENGTH) {
			throw new ValidationError(
				`workspace content must be at most ${MAX_WORKSPACE_CONTENT_LENGTH} characters`,
			);
		}
		const { root, config, operation } = await this.getReadyBookRoot(bookId, actor);
		const service = createDomainWritingResourceService(bookId, root, bookCountingMode(config));
		const chapterMatch = /^chapter:(\d{1,9})$/u.exec(resourceId);
		const updated = await this.withChapterIndexLock(operation.bookId, async () => {
			const current = chapterMatch
				? await service.findAcceptedChapter(bookId, Number(chapterMatch[1]))
				: await service.getById(bookId, rawWritingResourceId(resourceId));
			if (!current || current.status !== "accepted") {
				throw new NotFoundError("Writable workspace resource", resourceId);
			}
			return service.update(bookId, current.id, { content });
		});
		await updateBookTimestamp(root);
		this.invalidateWorkspaceFileTree(operation.bookId);
		return { resource: toWorkspaceWritingResource(updated) };
	}

	async createWorkspaceChapter(
		bookId: string,
		input: { title?: string },
		actor: ProductActor,
	): Promise<{ resource: ProductWorkspaceResource }> {
		const { root, config, operation } = await this.getReadyBookRoot(bookId, actor);
		const requestedTitle = typeof input.title === "string" ? input.title.trim() : "";
		if (requestedTitle.length > 200)
			throw new ValidationError("chapter title must be at most 200 characters");
		const service = createDomainWritingResourceService(bookId, root, bookCountingMode(config));
		const resource = await this.withChapterIndexLock(operation.bookId, async () => {
			const chapters = await service.list(bookId, { type: "chapter" });
			const chapterNumber =
				chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber ?? 0), 0) + 1;
			const isEnglish = config.language === "en";
			const title =
				requestedTitle || (isEnglish ? `Chapter ${chapterNumber}` : `第 ${chapterNumber} 章`);
			return service.create(bookId, {
				type: "chapter",
				status: "accepted",
				title,
				content: `# ${title}\n\n`,
				chapterNumber,
				source: "runtime:workspace",
				metadata: {},
			});
		});
		await updateBookTimestamp(root);
		this.invalidateWorkspaceFileTree(operation.bookId);
		return { resource: toWorkspaceWritingResource(resource) };
	}

	canAccessBinding(
		actor: ProductActor,
		binding: Pick<BookRuntimeBindingRecord, "createdByUserId">,
	): boolean {
		return ownsBookBinding(actor, binding.createdByUserId);
	}

	private async ensureProductNarratorWriteMode(narratorId: string): Promise<void> {
		const narrator = await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, narratorId) });
		if (narrator?.permissionMode !== "readOnly" || !narrator.traits?.includes("novelfork-product"))
			return;
		// Upgrade the P0 narrator shape on the server side. Raw narrator PATCH
		// remains blocked for bound books, so users cannot turn this into a
		// generic writable Runtime narrator from the browser.
		await runtimeDb
			.update(narrators)
			.set({
				permissionMode: "default",
				systemPrompt: NOVELIST_PROMPT,
				traits: [
						...new Set(
							narrator.traits.filter((trait: string) => trait !== "read-only").concat("chapter-write"),
						),
				],
				updatedAt: now(),
			})
			.where(eq(narrators.id, narratorId));
	}

	private mapBook(
		operation: ProvisionOperation,
		config: Record<string, unknown>,
	): ProductBookSummary {
		return {
			id: operation.bookId,
			title: operation.title,
			status: READY_STATE,
			runtimeProjectId: operation.runtimeProjectId ?? null,
			...getProductBookWritingConfig(config),
			updatedAt: operation.updatedAt,
			capabilities: bookCapabilities(),
		};
	}

	private mapNarrator(
		narrator: {
			id: string;
			title: string | null;
			model: string | null;
			reasoningEffort: string | null;
			permissionMode: string | null;
			planMode: boolean;
			cwd: string | null;
			status: string;
			messageCount: number | null;
			createdAt: string;
			updatedAt: string;
			lastMessageAt: string | null;
			errorMessage: string | null;
		},
		bookId: string,
	): ProductNarratorSummary {
		return {
			id: narrator.id,
			bookId,
			title: narrator.title ?? "小说创作助手",
			model: narrator.model,
			reasoningEffort: narrator.reasoningEffort,
			permissionMode: narrator.permissionMode,
			planMode: narrator.planMode,
			cwd: narrator.cwd,
			status: narrator.status,
			messageCount: narrator.messageCount ?? 0,
			createdAt: narrator.createdAt,
			updatedAt: narrator.updatedAt,
			lastMessageAt: narrator.lastMessageAt,
			errorMessage: narrator.errorMessage,
			capabilities: narratorCapabilities(canSendToConfiguredModel(narrator.model)),
		};
	}

	private async getReadyBookRoot(
		bookId: string,
		actor: ProductActor,
	): Promise<{
		operation: ProvisionOperation;
		root: string;
		config: Record<string, unknown>;
	}> {
		const operation = await this.getOperation(bookId, actor);
		if (operationState(operation) !== READY_STATE)
			throw new ValidationError("Book provisioning is not ready");
		if (operation.narratorId) await this.ensureProductNarratorWriteMode(operation.narratorId);
		const binding = await bookRuntimeBindingService.getByBookId(operation.bookId);
		if (!binding || !this.canAccessBinding(actor, binding))
			throw new NotFoundError("Book", operation.bookId);
		const input = operation.inputJson as ProductBookInput;
		const root = await resolveTrustedBookRoot(
			binding,
			getControlledBooksRoot(),
			isExternalBookWorkspace(input.projectInit),
		);
		if (!root)
			throw new ValidationError("Book binding no longer resolves to a readable workspace");
		return { operation, root, config: await readBookConfig(root, operation.bookId).catch(() => readImportBookConfig(root)) };
	}

	private async resume(
		operation: ProvisionOperation,
		actor: ProductActor,
	): Promise<ProvisionResult> {
		if (operation.actorUserId !== actor.userId && actor.role !== "admin") {
			throw new NotFoundError("Book provision operation", operation.bookId);
		}
		if (operationState(operation) === "ready") return operation;
		let current = operation;
		let warnings: readonly BookProvisionWarning[] = [];
		try {
			if (operationState(current) === "reserved" || operationState(current) === "failed") {
				await this.stageCore(current);
				current = await this.updateOperation(current.id, {
					state: "core-staged",
					errorMessage: null,
				});
			}
			if (
				operationState(current) === "core-staged" ||
				operationState(current) === "compensation-required"
			) {
				await this.promoteFilesystem(current);
				current = await this.updateOperation(current.id, {
					state: "filesystem-promoted",
					errorMessage: null,
				});
			}
			if (operationState(current) === "filesystem-promoted") {
				const bound = await this.bindRuntime(current);
				current = bound;
				warnings = bound.warnings ?? [];
			}
			if (operationState(current) === "runtime-bound") {
				current = await this.updateOperation(current.id, { state: "ready", errorMessage: null });
			}
			return warnings.length > 0 ? { ...current, warnings } : current;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const state: ProvisionState =
				operationState(current) === "reserved" ? "failed" : "compensation-required";
			return this.updateOperation(current.id, { state, errorMessage: message });
		}
	}

	private async stageCore(operation: ProvisionOperation): Promise<void> {
		const repository = createBookRepository(getStorageDatabase());
		const existing = await repository.getById(operation.bookId);
		if (existing) return;
		const timestamp = new Date(operation.createdAt);
		await repository.create({
			id: operation.bookId,
			name: operation.title,
			jingweiMode: "dynamic",
			currentChapter: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	}

	private async promoteFilesystem(operation: ProvisionOperation): Promise<void> {
		const input = operation.inputJson as ProductBookInput;
		const configuredWorkspace = input.projectInit?.workspaceRoot?.trim();
		const source = input.projectInit?.source ?? "none";
		const external = isExternalBookWorkspace(input.projectInit);
		const root = external
			? resolve(configuredWorkspace as string)
			: await this.controlledBookRoot(operation.bookId, true);
		const rootInfo = await stat(root).catch(() => null);
		if (rootInfo) {
			if (!rootInfo.isDirectory()) {
				throw new ValidationError(
					external ? "workspaceRoot must be a directory" : "Book root must be a directory",
				);
			}
			if (external) {
				if (await pathExists(join(root, "book.json"))) {
					if (source === "existing") {
						await readImportBookConfig(root);
						return;
					}
					// source=new into a directory that already has a book.json: only accept same id.
					await readBookConfig(root, operation.bookId).catch(() => {
						throw workspaceAlreadyABookError(root, "book.json");
					});
					return;
				}
				if (source === "existing") {
					await initializeExternalBookConfig(root, operation);
					return;
				}
				await writeBookScaffold(root, operation);
				return;
			}
			const config = await readBookConfig(root, operation.bookId).catch((error) => {
				if (isCreateOperation(operation)) {
					throw controlledBookRootOccupiedError(operation.bookId, true, false);
				}
				throw error;
			});
			// 兜底：建书发起的记录只沿用它自己上次转正的目录。脚手架在暂存目录写完后整体 rename，
			// book.json 里的 createdAt 就是这条记录的 createdAt；对不上说明目录不是本次建书写的
			// （例如预检之后才出现的旧书），不能沿用。认领、修复、导入的记录本来就是接入已有目录，不受影响。
			if (isCreateOperation(operation) && config.createdAt !== operation.createdAt) {
				throw controlledBookRootOccupiedError(operation.bookId, true, false);
			}
			return;
		}
		if (external) {
			await mkdir(resolve(root, ".."), { recursive: true });
		}
		const staging = join(resolve(root, ".."), `.${basename(root)}.provision-${operation.id}`);
		await rm(staging, { recursive: true, force: true });
		try {
			await writeBookScaffold(staging, operation);
			await rename(staging, root);
		} catch (error) {
			await rm(staging, { recursive: true, force: true }).catch(() => undefined);
			throw error;
		}
	}

	private async reserveRecoveredBindingOperation(
		bookId: string,
		binding: BookRuntimeBindingRecord,
		actor: ProductActor,
	): Promise<ProvisionOperation> {
		const root = await resolveTrustedBookRoot(binding, getControlledBooksRoot(), true);
		if (!root)
			throw new ValidationError("Book binding no longer resolves to a readable workspace");
		const config = await readBookConfig(root, bookId).catch(() => readImportBookConfig(root));
		const timestamp = now();
		const ownerId = binding.createdByUserId ?? actor.userId;
		const operation: ProvisionOperation = {
			id: generateId(),
			actorUserId: ownerId,
			idempotencyKey: `binding-repair:${bookId}:${randomUUID()}`,
			bookId,
			title: config.title as string,
			inputJson: {
				bookId,
				title: config.title as string,
				genre: typeof config.genre === "string" ? config.genre : undefined,
				language:
					config.language === "en" || config.language === "zh" ? config.language : undefined,
				platform:
					config.platform === "tomato" ||
					config.platform === "feilu" ||
					config.platform === "qidian"
						? config.platform
						: "other",
			},
			state: "core-staged",
			runtimeProjectId: binding.runtimeProjectId,
			runtimeChapterId: null,
			narratorId: null,
			errorMessage: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		await productDb().insert(bookProvisionOperations).values(operation);
		return operation;
	}

	private async bindRuntime(operation: ProvisionOperation): Promise<ProvisionResult> {
		const input = operation.inputJson as ProductBookInput;
		const external = isExternalBookWorkspace(input.projectInit);
		const root = external && input.projectInit?.workspaceRoot
			? await realpath(input.projectInit.workspaceRoot).catch(() => {
					throw new ValidationError("workspaceRoot does not exist");
				})
			: await this.controlledBookRoot(operation.bookId, false);
		await readBookConfig(root, operation.bookId).catch(async () => {
			if (external) await readImportBookConfig(root);
			else throw new ValidationError("Book metadata is invalid");
		});
		// Runtime 的项目即 git 仓库：落在受控根下的书（新建、复制导入、档案导入、认领都经这里）
		// 先按 NarraFork 的 init 口径初始化，再写项目行。要不要初始化只看物理位置，与删书判定一致；
		// 用户的外部目录一律不碰。git 不可用时不让建书失败，结果里带说明。
		const gitWarning = (await isProductOwnedBookRoot(root))
			? await initializeControlledBookGit(root, operation.actorUserId)
			: null;
		let current = operation;
		const projectId = current.runtimeProjectId ?? generateId();
		const chapterId = current.runtimeChapterId ?? generateId();
		const narratorId = current.narratorId ?? generateId();
		if (!current.runtimeProjectId || !current.runtimeChapterId || !current.narratorId) {
			current = await this.updateOperation(current.id, {
				runtimeProjectId: projectId,
				runtimeChapterId: chapterId,
				narratorId,
			});
		}
		const timestamp = now();
		// owner_user_id 是 users 外键：只有确实存在的用户才能落成 owner，否则整次建书会因为
		// 外键失败退回 compensation-required。解析失败时留空，项目退回「管理员管理」。
		const ownerUserId = await resolveRuntimeOwnerUserId(operation.actorUserId);
		const project = await runtimeDb.query.projects.findFirst({ where: eq(projects.id, projectId) });
		if (!project) {
			await runtimeDb.insert(projects).values({
				id: projectId,
				name: operation.title,
				description: "NovelFork controlled book runtime project",
				status: "active",
				flowMode: "classic",
				gitPath: root,
				defaultBranch: "main",
				// Runtime 的项目 ACL 是 owner / 显式授权制：visibility=public 只给「读」，
				// 写（启用技能、改可选工具覆盖、提交、合并）只认 owner 或 acl_grants 里的 write。
				// 产品建书必须把项目的 owner 落成本书的归属人，否则管理员以外的人打开写作台
				// 的 Runtime 项目设置会只读，保存直接 404。owner 是 users 外键，取值前先确认
				// 这个 id 在 Runtime 里真的是一个用户（见 resolveRuntimeOwnerUserId）。
				ownerUserId,
				// private 而非默认：一本书的项目不该因为 visibility=public 被同机其他用户读到。
				// 归属人经 owner 判定通过，不依赖这条可见性。
				visibility: "private" as const,
				chapterSettings: { autoCreateNarrator: false },
				createdAt: timestamp,
				updatedAt: timestamp,
			});
		} else if (!project.ownerUserId && ownerUserId) {
			// 本次修复前建的书，项目行没有 owner：只有管理员能在写作台的 Runtime 项目设置里
			// 写数据。这里就地补上归属人，让老书与新书走同一条授权路径。operation.actorUserId
			// 就是本书归属人（管理员代修别人的书时，它也仍是原作者，见 resume 的校验）。
			await runtimeDb
				.update(projects)
				.set({ ownerUserId, updatedAt: timestamp })
				.where(eq(projects.id, projectId));
		}
		const chapter = await runtimeDb.query.chapters.findFirst({ where: eq(chapters.id, chapterId) });
		if (!chapter) {
			await runtimeDb.insert(chapters).values({
				id: chapterId,
				projectId,
				title: ROOT_CHAPTER_TITLE,
				status: "active",
				role: "trunk",
				branch: "main",
				worktreePath: root,
				baseBranch: "main",
				isRoot: 1,
				lastAccessedAt: timestamp,
				createdAt: timestamp,
				updatedAt: timestamp,
			});
		}
		const narrator = await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, narratorId) });
		if (!narrator) {
			await runtimeDb.insert(narrators).values({
				id: narratorId,
				chapterId,
				type: "primary",
				title: `${operation.title} · 小说创作助手`,
				model: getProductNarratorModel(),
				systemPrompt: NOVELIST_PROMPT,
				// `default` deliberately keeps Runtime's permission gate in the loop.
				// The product restricts what can be written through the tool registry.
				permissionMode: "default",
				status: "idle",
				cwd: root,
				variant: "primary",
				traits: ["novelfork-product", "novelist", "chapter-write"],
				createdAt: timestamp,
				updatedAt: timestamp,
			});
		} else {
			await this.ensureProductNarratorWriteMode(narratorId);
		}
		await bookRuntimeBindingService.upsert(
			projectId,
			operation.bookId,
			operation.actorUserId,
			root,
		);
		const bound = await this.updateOperation(current.id, { state: "runtime-bound", errorMessage: null });
		return gitWarning ? { ...bound, warnings: [gitWarning] } : bound;
	}

	private async controlledBookRoot(bookId: string, createRoot: boolean): Promise<string> {
		const configuredRoot = getControlledBooksRoot();
		if (createRoot) await mkdir(configuredRoot, { recursive: true });
		const canonicalRoot = await (await import("node:fs/promises"))
			.realpath(configuredRoot)
			.catch(() => {
				throw new ValidationError("Controlled books root is not accessible");
			});
		return deriveBookRoot(canonicalRoot, bookId);
	}

	private async updateOperation(
		id: string,
		patch: Partial<
			Pick<
				ProvisionOperation,
				| "state"
				| "runtimeProjectId"
				| "runtimeChapterId"
				| "narratorId"
				| "errorMessage"
				| "inputJson"
				| "title"
			>
		>,
	): Promise<ProvisionOperation> {
		const [updated] = await productDb()
			.update(bookProvisionOperations)
			.set({ ...patch, updatedAt: now() })
			.where(eq(bookProvisionOperations.id, id))
			.returning();
		if (!updated) throw new NotFoundError("Book provision operation", id);
		return updated;
	}
}

export const novelForkProductBookService = new NovelForkProductBookService();
