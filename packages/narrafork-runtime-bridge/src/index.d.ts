/**
 * Public TypeScript contract for consumers outside the isolated Runtime tree.
 *
 * Runtime implementation modules stay on the `import` export condition. This
 * declaration surface deliberately keeps Runtime-owned database and service
 * internals opaque so TypeScript never combines their Bun-linked dependency
 * graph with a consumer's PNPM graph.
 */

export type RuntimeToolRisk = "read" | "draft-write" | "confirmed-write" | "destructive";
export type SessionPermissionMode = "ask" | "edit" | "allow" | "read" | "plan";
export type ToolVisibility = "author" | "advanced";

export interface ContributedToolPermissionPolicy {
	readonly risk: RuntimeToolRisk;
	readonly enabledForModes: readonly SessionPermissionMode[];
	readonly visibility: ToolVisibility;
	readonly resolveRisk?: (input?: Record<string, unknown>) => RuntimeToolRisk;
}

export interface RuntimeToolMetadata {
	runtimePluginId?: string;
	runtimeRisk?: RuntimeToolRisk;
	runtimeRenderer?: string;
	contributedPermission?: ContributedToolPermissionPolicy;
	[key: string]: unknown;
}

export interface RuntimeGenerateTextRequest {
	messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
	temperature?: number;
	maxTokens?: number;
}

export interface RuntimeGenerateTextResult {
	text: string;
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};
}

export interface ToolContext {
	narratorId: string;
	provider?: string;
	model?: string;
	generateText?: (request: RuntimeGenerateTextRequest) => Promise<RuntimeGenerateTextResult>;
	emitOutput?: (output: string) => void;
	[key: string]: unknown;
}

export interface ToolParameters {
	safeParse(input: unknown): { success: boolean; [key: string]: unknown };
}

export interface ToolResult {
	output: string;
	isError?: boolean;
	title?: string;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: ToolParameters;
	rawJsonSchema?: Record<string, unknown>;
	execute(
		args: Readonly<Record<string, unknown>>,
		context: ToolContext,
	): Promise<ToolResult>;
	metadata?: RuntimeToolMetadata;
}

export interface RuntimeResourceBinding {
	readonly kind: string;
	readonly root: string;
	readonly [key: string]: unknown;
}

export interface RuntimeResolveContext {
	readonly runtimeProjectId: string;
	readonly projectRoot: string;
	readonly projectType: string;
	readonly enabledPluginIds: readonly string[];
	readonly resourceBindings: Readonly<Record<string, RuntimeResourceBinding>>;
	readonly sessionId?: string;
}

export interface ResolvedRuntimeContributions {
	readonly tools: readonly { readonly definition: Readonly<{ name: string }> }[];
	readonly promptExtensions: readonly { readonly content: string }[];
}

export type RuntimeLearningContribution = unknown;

/** 中英两份文案（与 Runtime 的 RuntimeLearningLocalizedText 同形）。 */
export interface RuntimeLearningLocalizedText {
	readonly en: string;
	readonly "zh-CN": string;
}

/** 覆盖一篇 Runtime 内置学习文档的字段（与 Runtime 的 RuntimeLearningDocumentOverride 同形）。 */
export interface RuntimeLearningDocumentOverride {
	readonly category?: string;
	readonly tags?: readonly string[];
	readonly title?: RuntimeLearningLocalizedText;
	readonly summary?: RuntimeLearningLocalizedText;
	readonly sections?: readonly {
		readonly title: RuntimeLearningLocalizedText;
		readonly body: RuntimeLearningLocalizedText;
	}[];
	readonly workflow?: readonly RuntimeLearningLocalizedText[];
	readonly bestPractices?: readonly RuntimeLearningLocalizedText[];
	readonly pitfalls?: readonly RuntimeLearningLocalizedText[];
	readonly agentHints?: readonly RuntimeLearningLocalizedText[];
	readonly actions?: readonly {
		readonly label: RuntimeLearningLocalizedText;
		readonly description: RuntimeLearningLocalizedText;
		readonly href: string;
	}[];
}

/**
 * 产品如何呈现 Runtime 内置学习文档：品牌名替换、隐藏、逐篇覆盖、分类排序。
 * 只作用于内置文档，产品贡献的文档原样展示。旧版 Runtime 不认这个字段时忽略它。
 */
export interface RuntimeLearningPresentation {
	readonly brandName?: string;
	readonly hiddenBuiltinDocIds?: readonly string[];
	readonly builtinDocOverrides?: Readonly<Record<string, RuntimeLearningDocumentOverride>>;
	readonly builtinCategoryOverrides?: Readonly<
		Record<
			string,
			{ readonly label?: RuntimeLearningLocalizedText; readonly description?: RuntimeLearningLocalizedText }
		>
	>;
	readonly categoryOrder?: readonly string[];
}

/** NarraFork「可选工具」的三档。 */
export type RuntimeProductToolRoutineMode = "manual" | "auto" | "resident";

/**
 * 产品贡献的工具套路：与 Runtime 自带套路一起出现在「可选工具」、项目覆盖与 /load 里，
 * 由 Runtime 的套路体系决定会话启用哪些工具。
 */
export interface RuntimeProductToolRoutineContribution {
	/** 带命名空间的小写 id（如 `novelfork.writing`），也是 /load 参数。 */
	readonly id: string;
	readonly nameEn: string;
	readonly nameZh: string;
	readonly descriptionEn: string;
	readonly descriptionZh: string;
	/** Runtime 注册名（toolDefinitions() 返回的 name）。 */
	readonly toolNames: readonly string[];
	/** 全局与项目都没设置时的档位，缺省为 manual。 */
	readonly defaultMode?: RuntimeProductToolRoutineMode;
}

/**
 * 启用与可见分开：启用集合只由 Runtime 的套路模式、/load 与持久化加载决定；
 * 产品经 resolveContribution / resolveToolNames（可信绑定 + 工序收窄）与 isToolAllowed 只做可见性收窄。
 */
export interface RuntimeProductNarratorAdapter {
	resolve(narratorId: string): Promise<RuntimeResolveContext | null>;
	resolveContribution(narratorId: string): Promise<ResolvedRuntimeContributions | null>;
	resolveToolNames(narratorId: string): Promise<string[]>;
	resolveTrustedPromptRoot?(narratorId: string): Promise<string | null>;
	toolDefinitions(): ToolDefinition[];
	isToolAllowed?(
		toolName: string,
		enabledOptionalToolNames: ReadonlySet<string>,
		context?: Readonly<{ permissionMode?: SessionPermissionMode | string }>,
	): boolean;
	getToolPermissionPolicy?(toolName: string): ContributedToolPermissionPolicy | null;
	toolRoutines?(): readonly RuntimeProductToolRoutineContribution[];
}

export interface RuntimeProductAccessDeniedEvent {
	readonly type: "error";
	readonly code: string;
	readonly message: string;
	readonly narratorId?: string;
}

/**
 * 产品贡献的内置子代理模板（只读）。Runtime 按自定义子代理 toolAccess="custom" 处理：
 * 工具上限就是 tools（线上名），用户不能新建 / 改 / 删同名定义。
 */
export interface RuntimeProductSubagentTemplate {
	/** 带产品命名空间的小写 id（如 `nf-writer`），即 Agent 的 subagent_type。 */
	readonly id: string;
	readonly nameZh: string;
	readonly nameEn: string;
	readonly description: string;
	readonly tools: readonly string[];
	readonly defaultModel?: string;
	readonly prompt: string;
}

export interface RuntimeProductIntegration {
	id: string;
	/** 旧版 Runtime 不认这个字段时会忽略它（产品侧照常编译、降级为没有内置子代理）。 */
	subagentTemplates?: () => readonly RuntimeProductSubagentTemplate[];
	isProductNarrator?: (...args: any[]) => boolean;
	resolveNarratorCwd?: (...args: any[]) => string | null;
	initialize?: () => Promise<void> | void;
	shutdown?: () => Promise<void> | void;
	mountAuthenticatedGuards?: (app: any) => void;
	mountAuthenticatedRoutes?: (app: any) => void;
	mountRuntimeBindingRoutes?: (app: any) => void;
	learningContributions?: () => readonly RuntimeLearningContribution[];
	learningPresentation?: () => RuntimeLearningPresentation;
	narrator?: RuntimeProductNarratorAdapter;
	canAccessNarratorState?: (input: { userId: string | undefined; narratorId: string }) => Promise<boolean>;
	canAccessPermission?: (input: { userId: string | undefined; requestId: string }) => Promise<boolean>;
	createNarratorAccessDeniedEvent?: (narratorId?: string) => RuntimeProductAccessDeniedEvent;
}

/** Which configured Runtime model a product text generation follows. */
export type RuntimeProductTextModelRole = "default" | "summary";

export interface RuntimeProductTextMessage {
	readonly role: "system" | "user" | "assistant";
	readonly content: string;
}

/** Tool-free generation request: ToolContext.generateText's shape plus a model role. */
export interface RuntimeProductTextGenerationRequest {
	readonly messages: readonly RuntimeProductTextMessage[];
	/** Accepted for parity with ToolContext.generateText; currently not forwarded. */
	readonly temperature?: number;
	readonly maxTokens?: number;
	/** Defaults to "default". */
	readonly modelRole?: RuntimeProductTextModelRole;
}

/** Trusted caller identity, taken from the authenticated request only. */
export interface RuntimeProductTextGenerationOptions {
	readonly userId: string;
	readonly signal?: AbortSignal;
}

export interface RuntimeProductTextGenerationResult {
	readonly text: string;
	/** Concrete provider:model that served the request. */
	readonly model: string;
	readonly outputTruncated?: boolean;
	readonly usage?: {
		readonly promptTokens?: number;
		readonly completionTokens?: number;
		readonly totalTokens?: number;
	};
}

export type RuntimeProductTextGenerationUnavailableCode =
	| "MODEL_NOT_CONFIGURED"
	| "MODEL_PROVIDER_UNAVAILABLE";

export type RuntimeProductTextGenerationStatus =
	| {
			readonly available: true;
			readonly modelRole: RuntimeProductTextModelRole;
			readonly provider: string;
			readonly model: string;
	  }
	| {
			readonly available: false;
			readonly modelRole: RuntimeProductTextModelRole;
			readonly code: RuntimeProductTextGenerationUnavailableCode;
			readonly message: string;
	  };

/** Runtime-owned services callable from authenticated product server code. */
export interface RuntimeProductHostServices {
	getTextGenerationStatus(
		modelRole?: RuntimeProductTextModelRole,
	): Promise<RuntimeProductTextGenerationStatus>;
	generateText(
		request: RuntimeProductTextGenerationRequest,
		options: RuntimeProductTextGenerationOptions,
	): Promise<RuntimeProductTextGenerationResult>;
}

/** Lazy Runtime text generation; model, routing and usage accounting stay in the Runtime. */
export const runtimeProductHostServices: RuntimeProductHostServices;

export class AppError extends Error {
	constructor(message: string, statusCode?: number, code?: string, details?: unknown);
	readonly statusCode: number;
	readonly code: string;
	readonly details?: unknown;
}

export class NotFoundError extends AppError {
	constructor(resource: string, id: string);
}

export class ValidationError extends AppError {
	constructor(message: string, details?: unknown);
}

export interface McpToolPermission {
	toolName: string;
	behavior: "readOnly" | "readWrite" | "ask" | "deny";
	enabled?: boolean;
}

export interface ProjectMcpServerOverride {
	serverId: string;
	defaultBehavior?: McpToolPermission["behavior"];
	toolPermissions?: McpToolPermission[];
}

export interface SkillInfo {
	name: string;
	description: string;
	content: string;
	files: string[];
	disabled?: boolean;
	[key: string]: unknown;
}

export interface LearningCategory {
	id: string;
	[key: string]: unknown;
}

export interface LearningDoc {
	id: string;
	[key: string]: unknown;
}

export interface LearningDocSummary {
	id: string;
	[key: string]: unknown;
}

export interface NarratorServerMessage {
	type: string;
	[key: string]: unknown;
}

export interface RuntimeQueryOptions {
	where?: object | ((table: any, operators: any) => unknown);
	orderBy?: object | ((table: any, operators: any) => unknown);
	columns?: object;
	limit?: number;
	[key: string]: unknown;
}

export interface RuntimeQueryTable {
	findFirst(options?: RuntimeQueryOptions): any;
	findMany(options?: RuntimeQueryOptions): Promise<any[]>;
}

export interface RuntimeDatabase {
	query: Record<string, RuntimeQueryTable>;
	select(...args: any[]): any;
	insert(table: any): any;
	update(table: any): any;
	delete(table: any): any;
	run(query: any): { changes: number };
	all<T = unknown>(query: any): T[];
	transaction<T>(callback: (tx: RuntimeDatabase) => T): T;
}

export interface RuntimeClineProvider {
	id: string;
	disabled?: boolean;
	prefix: string;
	name?: string;
	accessToken?: string;
	baseUrl: string;
	defaultModel: string;
	[key: string]: unknown;
}

export const db: RuntimeDatabase;
export const narratorMessageRefs: any;
export const narratorMessages: any;
export const narrators: any;
export const narratorToolCalls: any;
export const projects: any;
export const users: any;
export const settings: {
	customApiProviders?: any[];
	openaiProviders?: any[];
	anthropicProviders?: any[];
	nugProviders?: any[];
	clineProviders: RuntimeClineProvider[];
	mcpServers?: readonly { id: string; [key: string]: unknown }[];
	agent: { defaultModel: string; disabledProviders?: readonly string[]; [key: string]: unknown };
	[key: string]: any;
};
/** 整体写回 Runtime 全局设置（settings.json）；传入的对象会成为新的设置单例内容。 */
export function saveSettings(newSettings: typeof settings): void;
/** 可选工具套路在全局 settings.routines 与项目 chapterSettings.routines 里的存储形态。 */
export interface RoutineModeConfig {
	disabledRoutines?: string[];
	enabledRoutines?: string[];
	toolModes?: Record<string, string>;
}
export type ResolvedRoutineModeConfig<T extends RoutineModeConfig> = Omit<
	T,
	"disabledRoutines" | "enabledRoutines" | "toolModes"
> & {
	disabledRoutines: string[];
	enabledRoutines: string[];
	toolModes: Record<string, string>;
};
/** 写入一个套路的模式并同步旧白名单 / 黑名单（resident 进白名单，manual 进黑名单，auto 都不进）。 */
export function applyToolRoutineMode<T extends RoutineModeConfig>(
	config: T,
	routineId: string,
	mode: RuntimeProductToolRoutineMode,
): ResolvedRoutineModeConfig<T>;
/** 去掉这一层对某个套路的全部表态（跟随上一层）。 */
export function clearToolRoutineMode<T extends RoutineModeConfig>(
	config: T,
	routineId: string,
): ResolvedRoutineModeConfig<T>;
export function normalizeToolRoutineMode(raw: unknown): RuntimeProductToolRoutineMode | null;
export const logger: any;
export const hookService: any;
export const skillService: any;
export function getPluginManager(): Promise<any>;
export const FOLLOW_DEFAULT_MODEL: any;
export const createHookSchema: any;
export const createProjectSkillSchema: any;
export const updateHookSchema: any;
export const updateProjectSkillSchema: any;

export const registerRuntimeProductIntegration: (...args: any[]) => any;
export const getDbDir: () => string;
export const getDbPath: () => string;
export const generateId: (...args: any[]) => string;
export const requireAdmin: (...args: any[]) => any;
export const deleteProjectById: (id: string) => Promise<void>;
export const disableRoutineForProject: (...args: any[]) => Promise<void>;
export const enableRoutineForProject: (...args: any[]) => Promise<void>;
export const getProjectRoutineStatusesWithOverride: (...args: any[]) => any[];
export const resetRoutineForProject: (...args: any[]) => Promise<void>;
export const setToolRoutineModeForProject: (
	routineId: string,
	projectId: string,
	mode: RuntimeProductToolRoutineMode | "global",
) => Promise<void>;
export const getLearningCategories: (...args: any[]) => LearningCategory[];
export const getLearningDoc: (...args: any[]) => LearningDoc | null;
export const getLearningDocSummaries: (...args: any[]) => LearningDocSummary[];
export const searchLearningDocs: (...args: any[]) => LearningDocSummary[];
export const loadGlobalPrompt: (...args: any[]) => Promise<any>;
export const writeGlobalPrompt: (...args: any[]) => Promise<any>;
