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
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	chapters,
	db as runtimeDb,
	deleteProjectById,
	generateId,
	isKiroAvailable,
	narrators,
	NotFoundError,
	projects,
	settings,
	ValidationError,
} from "@vivy1024/narrafork-runtime-bridge";
import { getStorageDatabase, resolveBookStorageDir } from "@vivy1024/novelfork-core";
import { and, desc, eq } from "drizzle-orm";
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
import type { WritingResource } from "../../../novel-plugin/src/engine/writing-resource/types";
import { getNovelForkProductDatabase } from "../db/database";
import { bookProvisionOperations } from "../db/schema";
import { ownsBookBinding } from "../policy/book-product-policy";
import {
	type BookRuntimeBindingRecord,
	bookRuntimeBindingService,
	deriveBookRoot,
	EXTERNAL_BOOK_WORKSPACE_MARKER,
	getControlledBooksRoot,
	resolveTrustedBookRoot,
} from "./book-binding";

type ProvisionState =
	| "reserved"
	| "core-staged"
	| "filesystem-promoted"
	| "runtime-bound"
	| "ready"
	| "failed"
	| "compensation-required";

type ProvisionOperation = typeof bookProvisionOperations.$inferSelect;

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
};

const READY_STATE: ProvisionState = "ready";
const ROOT_CHAPTER_TITLE = "小说主线";
const NOVELIST_PROMPT =
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 scene.spec 建立蓝图，再使用 pipeline.write；它会执行本书的字数、预设、节拍和审校治理。没有可用文本模型时必须如实说明阻塞，绝不能用 chapter.write 写入短文本充当新章节。chapter.write 仅用于覆盖已存在的完整章节，局部改写使用 rewrite.apply；所有写入都遵守 Runtime 权限确认。不要使用通用文件或命令工具绕过书籍领域边界。";

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
	updatedAt: string;
	capabilities: RuntimeEntityCapabilities;
};

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

const MAX_WORKSPACE_TREE_DEPTH = 16;
const MAX_WORKSPACE_FILE_BYTES = 2_000_000;
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
	options: { allowRoot?: boolean; requireExisting?: boolean } = {},
): Promise<{ absolutePath: string; relativePath: string }> {
	const relativePath = normalizeWorkspacePath(rawPath, { allowRoot: options.allowRoot });
	const absolutePath = resolve(bookRoot, relativePath);
	if (!pathIsContained(bookRoot, absolutePath)) {
		throw new ValidationError("workspace path escapes the trusted book root");
	}

	const existingPath = options.requireExisting === false
		? dirname(absolutePath)
		: absolutePath;
	const canonicalExistingPath = await realpath(existingPath).catch(() => {
		throw new ValidationError(options.requireExisting === false ? "workspace parent directory does not exist" : "workspace path does not exist");
	});
	if (!pathIsContained(bookRoot, canonicalExistingPath)) {
		throw new ValidationError("workspace path resolves outside the trusted book root");
	}
	return { absolutePath, relativePath };
}

function assertMutableWorkspacePath(relativePath: string): void {
	if (PROTECTED_WORKSPACE_FILES.has(relativePath)) {
		throw new ValidationError(`${relativePath} is managed by NovelFork and cannot be changed from the IDE file tree`);
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
const CHAPTER_FILE_PATTERN = /^(\d{1,9})[_-].+\.md$/iu;

type ControlledChapterFile = {
	number: number;
	fileName: string;
	relativePath: string;
};

function configuredValue(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

function isConfiguredApiProvider(provider: {
	disabled?: boolean;
	name?: string;
	prefix?: string;
	apiKey?: string;
	baseUrl?: string;
	defaultModel?: string;
}): boolean {
	return (
		!provider.disabled &&
		configuredValue(provider.prefix) &&
		configuredValue(provider.apiKey) &&
		configuredValue(provider.baseUrl) &&
		configuredValue(provider.defaultModel)
	);
}

type ConfiguredProductProvider = { prefix: string; label: string; model: string };

/**
 * This intentionally reports local configuration only. It is not a network
 * probe: a configured key/endpoint can still fail at request time.
 */
function getConfiguredProductProviders(): ConfiguredProductProvider[] {
	const configured = [
		...(settings.customApiProviders ?? []),
		...(settings.openaiProviders ?? []),
		...(settings.anthropicProviders ?? []),
		...(settings.nugProviders ?? []),
	]
		.filter(isConfiguredApiProvider)
		.map((provider) => ({
			prefix: provider.prefix,
			label: provider.name || provider.prefix,
			model: provider.defaultModel.includes(":")
				? provider.defaultModel
				: `${provider.prefix}:${provider.defaultModel}`,
		}));
	const cline = (settings.clineProviders ?? [])
		.filter(
			(provider) =>
				!provider.disabled &&
				configuredValue(provider.prefix) &&
				configuredValue(provider.accessToken) &&
				configuredValue(provider.baseUrl) &&
				configuredValue(provider.defaultModel),
		)
		.map((provider) => ({
			prefix: provider.prefix,
			label: provider.name || provider.prefix,
			model: provider.defaultModel.includes(":")
				? provider.defaultModel
				: `${provider.prefix}:${provider.defaultModel}`,
		}));
	configured.push(...cline);
	const kiroDisabled =
		process.env.NARRAFORK_DISABLE_KIRO_PROVIDER === "1" ||
		settings.agent.disabledProviders?.includes("kiro");
	if (!kiroDisabled && isKiroAvailable()) {
		configured.push({ prefix: "kiro", label: "Kiro", model: "kiro:claude-sonnet-4.5" });
	}
	return configured;
}

export function getProductModelStatus(): ProductModelStatus {
	const configured = getConfiguredProductProviders()[0];
	return configured
		? { setupRequired: false, label: `已配置：${configured.label}` }
		: { setupRequired: true };
}

function canSendToConfiguredModel(model: string | null): boolean {
	const selected = (model || settings.agent.defaultModel).trim();
	const prefix = selected.includes(":") ? selected.slice(0, selected.indexOf(":")) : "";
	return (
		Boolean(prefix) &&
		getConfiguredProductProviders().some((provider) => provider.prefix === prefix)
	);
}

function getProductNarratorModel(): string | null {
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

function normalizeInput(
	input: ProductBookInput,
): Required<Pick<ProductBookInput, "title">> & ProductBookInput {
	const title = input.title.trim();
	if (!title) throw new ValidationError("title is required");
	if (title.length > 200) throw new ValidationError("title must be at most 200 characters");
	const rawProjectInit = input.projectInit as Partial<NonNullable<ProductBookInput["projectInit"]>> | undefined;
	const source = rawProjectInit?.source ?? (rawProjectInit as { repositorySource?: ProductBookWorkspaceSource } | undefined)?.repositorySource ?? "none";
	const workspaceRoot = rawProjectInit?.workspaceRoot?.trim() || undefined;
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

function publicOperation(operation: ProvisionOperation) {
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
	};
}

async function pathExists(path: string): Promise<boolean> {
	return Boolean(await stat(path).catch(() => null));
}

function chapterFileFromName(fileName: string): ControlledChapterFile | null {
	const match = CHAPTER_FILE_PATTERN.exec(fileName);
	if (!match) return null;
	const number = Number(match[1]);
	if (!Number.isSafeInteger(number) || number < 1) return null;
	return { number, fileName, relativePath: join("chapters", fileName) };
}

async function listControlledChapterFiles(bookRoot: string): Promise<ControlledChapterFile[]> {
	const entries = await readdir(join(bookRoot, "chapters"), { withFileTypes: true }).catch(
		() => [],
	);
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => chapterFileFromName(entry.name))
		.filter((entry): entry is ControlledChapterFile => entry !== null)
		.sort(
			(left, right) => left.number - right.number || left.fileName.localeCompare(right.fileName),
		);
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
			const chapter = folder === "chapters" ? chapterFileFromName(entry.name) : null;
			const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
			resources.push({
				id: chapter ? chapterResourceId(chapter.number) : `${folder}:${normalizedPath}`,
				kind: chapter ? "chapter" : folder,
				title: chapter ? chapterTitle(chapter, content) : heading || basename(entry.name, ".md"),
				content,
				path: normalizedPath,
				metadata: {
					bookId,
					fileName: entry.name,
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

async function readChapterIndex(bookRoot: string): Promise<Record<string, unknown>[]> {
	const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8").catch(() => "[]");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ValidationError("Book chapter index is invalid");
	}
	if (!Array.isArray(parsed)) throw new ValidationError("Book chapter index is invalid");
	return parsed.filter(
		(entry): entry is Record<string, unknown> =>
			Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
	);
}

async function writeChapterIndex(
	bookRoot: string,
	index: readonly Record<string, unknown>[],
): Promise<void> {
	await writeFile(
		join(bookRoot, "chapters", "index.json"),
		`${JSON.stringify(index, null, 2)}\n`,
		"utf8",
	);
}

async function updateBookTimestamp(
	bookRoot: string,
	config: Record<string, unknown>,
): Promise<void> {
	await writeFile(
		join(bookRoot, "book.json"),
		`${JSON.stringify({ ...config, updatedAt: now() }, null, 2)}\n`,
		"utf8",
	);
}

async function readBookConfig(
	bookRoot: string,
	expectedBookId: string,
): Promise<Record<string, unknown>> {
	const raw = await readFile(join(bookRoot, "book.json"), "utf8").catch(() => {
		throw new ValidationError("Book does not have a readable book.json");
	});
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
	await writeFile(
		join(bookRoot, "book.json"),
		`${JSON.stringify(config, null, 2)}\n`,
		options?.exclusive ? { encoding: "utf8", flag: "wx" } : "utf8",
	);
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
	await writeBookConfig(bookRoot, config);
	await writeFile(join(bookRoot, "chapters", "index.json"), "[]\n", "utf8");
	await Promise.all(
		storyFiles.map(([name, content]) => writeFile(join(bookRoot, "story", name), content, "utf8")),
	);
}

function resolveDomainBookRoot(bookId: string): string {
	return resolveBookStorageDir(dirname(getControlledBooksRoot()), bookId);
}

function createDomainWritingResourceService(bookId: string, bookRoot?: string) {
	const domainRoot = bookRoot ?? resolveDomainBookRoot(bookId);
	return createWritingResourceService({
		storage: getStorageDatabase(),
		resolveBookDir: (requestedBookId) => {
			if (requestedBookId !== bookId)
				throw new ValidationError("Writing resource book binding mismatch");
			return domainRoot;
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
	const editable = resource.status === "accepted" || resource.status === "draft";
	return {
		id: workspaceResourceId(resource),
		kind: resource.type,
		title:
			resource.title || (resource.chapterNumber ? `第 ${resource.chapterNumber} 章` : "未命名资源"),
		content: resource.content,
		path: `writing-resources/${resource.id}`,
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
			const config = root ? await readBookConfig(root, operation.bookId).catch(() => null) : null;
			if (!config) continue;
			results.push(this.mapBook(operation));
		}
		return results;
	}

	async deleteBook(bookId: string, actor: ProductActor, deleteWorkspace = false): Promise<void> {
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
		const input = operation.inputJson as ProductBookInput;
		const trustedBookRoot = await resolveTrustedBookRoot(
			binding,
			getControlledBooksRoot(),
			isExternalBookWorkspace(input.projectInit),
		);
		if (!trustedBookRoot) {
			throw new ValidationError("Book binding does not resolve to a trusted product directory");
		}

		// Tear down the Runtime project first. On Windows, its watcher/git process can
		// hold the book directory open and make a pre-delete rename fail with EPERM.
		// Project deletion closes those handles and cascades the trusted binding.
		await deleteProjectById(operation.runtimeProjectId);
		await bookRuntimeBindingService.deleteByProjectId(operation.runtimeProjectId);
		await productDb().delete(bookProvisionOperations).where(eq(bookProvisionOperations.id, operation.id));
		// The standalone core catalog is not initialized in every Runtime process
		// (including gateway-only tests). Its row is a derived index; the trusted
		// directory and Runtime records above are the authoritative deletion.
		try {
			const storage = await getStorageDatabase();
			storage.sqlite.run("DELETE FROM book WHERE id = ?", normalizedBookId);
		} catch {
			// A later create/import safely upserts this derived catalog entry.
		}
		if (deleteWorkspace || (operation.inputJson as ProductBookInput).projectInit?.managedByNovelFork !== false) {
			await rm(trustedBookRoot, { recursive: true, force: true });
		}
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

		const bookId = input.bookId ?? generatedBookId(input.title);
		const alreadyReserved = await productDb().query.bookProvisionOperations.findFirst({
			where: eq(bookProvisionOperations.bookId, bookId),
			columns: { id: true },
		});
		if (alreadyReserved)
			throw new ValidationError("A provision operation already exists for this bookId");

		const operation: ProvisionOperation = {
			id: generateId(),
			actorUserId: actor.userId,
			idempotencyKey: key,
			bookId,
			title: input.title,
			inputJson: input,
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
		const sourcePath = rawInput.sourcePath.trim();
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
				`${JSON.stringify(importedConfig, null, 2)}\\n`,
				"utf8",
			);
			await mkdir(join(stagingRoot, "chapters"), { recursive: true });
			if (!(await pathExists(join(stagingRoot, "chapters", "index.json"))))
				await writeFile(join(stagingRoot, "chapters", "index.json"), "[]\\n", "utf8");
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
		const rawRoot = workspaceRoot.trim();
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
		await writeFile(join(root, "book.json"), `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

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

		// Keep provision input in sync so delete/list continue treating this as
		// an external workspace and do not force-delete the user's directory.
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
		const { operation, root, config } = await this.getReadyBookRoot(bookId, actor);
		const nextConfig: Record<string, unknown> = {
			...config,
			...patch,
			updatedAt: now(),
		};
		if (patch.targetChapters === null) delete nextConfig.targetChapters;
		const title = typeof nextConfig.title === "string" ? nextConfig.title.trim() : "";
		if (!title) throw new ValidationError("Book title must not be empty");
		nextConfig.title = title;
		await writeBookConfig(root, nextConfig);

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
		const { root, config } = await this.getReadyBookRoot(bookId, actor);
		const answers = normalizeGuidedSetupAnswers(input.answers);
		const genre = guidedAnswerText(answers.genre) ?? String(config.genre ?? "未分类");
		const template = getGenreTemplate(genre);
		const chapterWordCount =
			parseGuidedChapterWordCount(guidedAnswerText(answers.chapterWordCount)) ??
			(typeof config.chapterWordCount === "number" ? config.chapterWordCount : 3000);
		const platform = mapGuidedPlatform(guidedAnswerText(answers.platform)) ??
			(typeof config.platform === "string" ? config.platform : "other");

		const nextConfig: Record<string, unknown> = {
			...config,
			genre,
			platform,
			chapterWordCount,
			complexity: template.complexity,
			status: config.status === "incubating" ? "outlining" : config.status,
			updatedAt: now(),
		};
		const aiTaste = guidedAnswerText(answers.aiTasteLevel);
		if (aiTaste) nextConfig.aiTasteLevel = aiTaste;
		const writingPhilosophy = guidedAnswerText(answers.writingPhilosophy);
		if (writingPhilosophy) nextConfig.writingPhilosophy = writingPhilosophy;
		const tone = guidedAnswerText(answers.tone);
		if (tone) nextConfig.tone = tone;

		await writeBookConfig(root, nextConfig);

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

		return {
			ok: true,
			bookId,
			createdEntries: created,
			genre,
			complexity: template.complexity,
		};
	}

	async getWorkspaceFileTree(
		bookId: string,
		actor: ProductActor,
		depth = 8,
	): Promise<{ root: string; tree: ProductWorkspaceFileEntry[] }> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const maxDepth = Math.max(0, Math.min(Math.floor(depth), MAX_WORKSPACE_TREE_DEPTH));
		const walk = async (relativeDir: string, remainingDepth: number): Promise<ProductWorkspaceFileEntry[]> => {
			const { absolutePath } = await resolveWorkspacePath(root, relativeDir, { allowRoot: true, requireExisting: true });
			const entries = await readdir(absolutePath, { withFileTypes: true });
			const result: ProductWorkspaceFileEntry[] = [];
			for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
				if (entry.isSymbolicLink()) continue;
				const childPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
				const child = await resolveWorkspacePath(root, childPath, { requireExisting: true }).catch(() => null);
				if (!child) continue;
				const info = await stat(child.absolutePath).catch(() => null);
				if (!info) continue;
				if (entry.isDirectory() && info.isDirectory()) {
					result.push({
						name: entry.name,
						path: childPath,
						type: "directory",
						mtime: info.mtime.toISOString(),
						...(remainingDepth > 0 ? { children: await walk(childPath, remainingDepth - 1) } : {}),
					});
				} else if (entry.isFile() && info.isFile()) {
					result.push({ name: entry.name, path: childPath, type: "file", size: info.size, mtime: info.mtime.toISOString() });
				}
			}
			return result;
		};
		return { root, tree: await walk("", maxDepth) };
	}

	async readWorkspaceFile(bookId: string, rawPath: string, actor: ProductActor): Promise<{ path: string; content: string }> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const target = await resolveWorkspacePath(root, rawPath, { requireExisting: true });
		const info = await stat(target.absolutePath);
		if (!info.isFile()) throw new ValidationError("workspace path must identify a file");
		if (info.size > MAX_WORKSPACE_FILE_BYTES) throw new ValidationError("workspace file is too large to open in the IDE");
		return { path: target.relativePath, content: await readFile(target.absolutePath, "utf8") };
	}

	async writeWorkspaceFile(bookId: string, rawPath: string, content: string, actor: ProductActor): Promise<{ path: string }> {
		if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_FILE_BYTES) {
			throw new ValidationError(`workspace content must be at most ${MAX_WORKSPACE_FILE_BYTES} bytes`);
		}
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const normalizedPath = normalizeWorkspacePath(rawPath);
		assertMutableWorkspacePath(normalizedPath);
		const target = await resolveWorkspacePath(root, normalizedPath, { requireExisting: false });
		const info = await stat(target.absolutePath).catch(() => null);
		if (info && !info.isFile()) throw new ValidationError("workspace path must identify a file");
		await writeFile(target.absolutePath, content, "utf8");
		return { path: target.relativePath };
	}

	async mkdirWorkspacePath(bookId: string, rawPath: string, actor: ProductActor): Promise<{ path: string }> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const target = await resolveWorkspacePath(root, rawPath, { requireExisting: false });
		if (await stat(target.absolutePath).catch(() => null)) throw new ValidationError("workspace path already exists");
		await mkdir(target.absolutePath);
		return { path: target.relativePath };
	}

	async renameWorkspacePath(bookId: string, from: string, to: string, actor: ProductActor): Promise<{ from: string; to: string }> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const source = await resolveWorkspacePath(root, from, { requireExisting: true });
		const destinationPath = normalizeWorkspacePath(to);
		assertMutableWorkspacePath(source.relativePath);
		assertMutableWorkspacePath(destinationPath);
		const destination = await resolveWorkspacePath(root, destinationPath, { requireExisting: false });
		if (await stat(destination.absolutePath).catch(() => null)) throw new ValidationError("workspace destination already exists");
		await rename(source.absolutePath, destination.absolutePath);
		return { from: source.relativePath, to: destination.relativePath };
	}

	async deleteWorkspacePath(bookId: string, rawPath: string, actor: ProductActor): Promise<{ path: string }> {
		const { root } = await this.getReadyBookRoot(bookId, actor);
		const target = await resolveWorkspacePath(root, rawPath, { requireExisting: true });
		assertMutableWorkspacePath(target.relativePath);
		await rm(target.absolutePath, { recursive: true, force: false });
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
		const { operation, root } = await this.getReadyBookRoot(bookId, actor);
		const resources = (await createDomainWritingResourceService(bookId, root).list(bookId)).map(
			toWorkspaceWritingResource,
		);
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
			book: this.mapBook(operation),
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
		const { root, config } = await this.getReadyBookRoot(bookId, actor);
		const service = createDomainWritingResourceService(bookId, root);
		const chapterMatch = /^chapter:(\d{1,9})$/u.exec(resourceId);
		const current = chapterMatch
			? await service.findAcceptedChapter(bookId, Number(chapterMatch[1]))
			: await service.getById(bookId, rawWritingResourceId(resourceId));
		if (!current || (current.status !== "accepted" && current.status !== "draft")) {
			throw new NotFoundError("Writable workspace resource", resourceId);
		}
		const updated = await service.update(bookId, current.id, { content });
		await updateBookTimestamp(root, config);
		return { resource: toWorkspaceWritingResource(updated) };
	}

	async createWorkspaceChapter(
		bookId: string,
		input: { title?: string },
		actor: ProductActor,
	): Promise<{ resource: ProductWorkspaceResource }> {
		const { root, config } = await this.getReadyBookRoot(bookId, actor);
		const requestedTitle = typeof input.title === "string" ? input.title.trim() : "";
		if (requestedTitle.length > 200)
			throw new ValidationError("chapter title must be at most 200 characters");
		const service = createDomainWritingResourceService(bookId, root);
		const chapters = await service.list(bookId, { type: "chapter" });
		const chapterNumber =
			chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber ?? 0), 0) + 1;
		const isEnglish = config.language === "en";
		const title =
			requestedTitle || (isEnglish ? `Chapter ${chapterNumber}` : `第 ${chapterNumber} 章`);
		const resource = await service.create(bookId, {
			type: "chapter",
			status: "accepted",
			title,
			content: `# ${title}\n\n`,
			chapterNumber,
			source: "runtime:workspace",
			metadata: {},
		});
		await updateBookTimestamp(root, config);
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
						narrator.traits.filter((trait) => trait !== "read-only").concat("chapter-write"),
					),
				],
				updatedAt: now(),
			})
			.where(eq(narrators.id, narratorId));
	}

	private mapBook(operation: ProvisionOperation): ProductBookSummary {
		return {
			id: operation.bookId,
			title: operation.title,
			status: READY_STATE,
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
	): Promise<ProvisionOperation> {
		if (operation.actorUserId !== actor.userId && actor.role !== "admin") {
			throw new NotFoundError("Book provision operation", operation.bookId);
		}
		if (operationState(operation) === "ready") return operation;
		let current = operation;
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
				current = await this.bindRuntime(current);
			}
			if (operationState(current) === "runtime-bound") {
				current = await this.updateOperation(current.id, { state: "ready", errorMessage: null });
			}
			return current;
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
						throw new ValidationError(
							"所选目录已存在其他作品的 book.json，请换空目录或使用「已有 workspace」",
						);
					});
					return;
				}
				if (source === "existing") {
					await initializeExternalBookConfig(root, operation);
					return;
				}
				// source=new on an existing empty/non-book directory: scaffold in place.
				await writeBookScaffold(root, operation);
				return;
			}
			await readBookConfig(root, operation.bookId);
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

	private async bindRuntime(operation: ProvisionOperation): Promise<ProvisionOperation> {
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
				chapterSettings: { autoCreateNarrator: false },
				createdAt: timestamp,
				updatedAt: timestamp,
			});
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
		return this.updateOperation(current.id, { state: "runtime-bound", errorMessage: null });
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
