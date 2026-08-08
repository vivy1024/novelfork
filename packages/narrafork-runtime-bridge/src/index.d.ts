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

export interface RuntimeProductNarratorAdapter {
	resolve(narratorId: string): Promise<RuntimeResolveContext | null>;
	resolveContribution(narratorId: string): Promise<ResolvedRuntimeContributions | null>;
	resolveToolNames(narratorId: string): Promise<string[]>;
	resolveTrustedPromptRoot?(narratorId: string): Promise<string | null>;
	toolDefinitions(): ToolDefinition[];
	isToolAllowed?(toolName: string, enabledOptionalToolNames: ReadonlySet<string>): boolean;
	syncToolVisibility?(enabledToolNames: Set<string>, resolvedToolNames: readonly string[]): void;
}

export interface RuntimeProductAccessDeniedEvent {
	readonly type: "error";
	readonly code: string;
	readonly message: string;
	readonly narratorId?: string;
}

export interface RuntimeProductIntegration {
	id: string;
	isProductNarrator?: (...args: any[]) => boolean;
	resolveNarratorCwd?: (...args: any[]) => string | null;
	initialize?: () => Promise<void> | void;
	shutdown?: () => Promise<void> | void;
	mountAuthenticatedGuards?: (app: any) => void;
	mountAuthenticatedRoutes?: (app: any) => void;
	mountRuntimeBindingRoutes?: (app: any) => void;
	learningContributions?: () => readonly RuntimeLearningContribution[];
	narrator?: RuntimeProductNarratorAdapter;
	canAccessNarratorState?: (input: { userId: string | undefined; narratorId: string }) => Promise<boolean>;
	canAccessPermission?: (input: { userId: string | undefined; requestId: string }) => Promise<boolean>;
	createNarratorAccessDeniedEvent?: (narratorId?: string) => RuntimeProductAccessDeniedEvent;
}

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
export const chapters: any;
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
export const logger: any;
export const hookService: any;
export const skillService: any;
export const FOLLOW_DEFAULT_MODEL: any;
export const createHookSchema: any;
export const createProjectSkillSchema: any;
export const updateHookSchema: any;
export const updateProjectSkillSchema: any;

export const registerRuntimeProductIntegration: (...args: any[]) => any;
export const getDbDir: () => string;
export const getDbPath: () => string;
export const generateId: (...args: any[]) => string;
export const isKiroAvailable: (...args: any[]) => boolean;
export const requireAdmin: (...args: any[]) => any;
export const deleteProjectById: (id: string) => Promise<void>;
export const disableRoutineForProject: (...args: any[]) => Promise<void>;
export const enableRoutineForProject: (...args: any[]) => Promise<void>;
export const getProjectRoutineStatusesWithOverride: (...args: any[]) => any[];
export const resetRoutineForProject: (...args: any[]) => Promise<void>;
export const getLearningCategories: (...args: any[]) => LearningCategory[];
export const getLearningDoc: (...args: any[]) => LearningDoc | null;
export const getLearningDocSummaries: (...args: any[]) => LearningDocSummary[];
export const searchLearningDocs: (...args: any[]) => LearningDocSummary[];
export const loadGlobalPrompt: (...args: any[]) => Promise<any>;
export const writeGlobalPrompt: (...args: any[]) => Promise<any>;
