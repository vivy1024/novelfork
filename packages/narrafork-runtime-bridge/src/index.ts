import type { McpToolPermission as RuntimeMcpToolPermission } from "../../narrafork-runtime-private/server/lib/settings";
import type {
	ToolContext as RuntimeToolContext,
	ToolDefinition as RuntimeToolDefinition,
	ToolResult as RuntimeToolResult,
} from "../../narrafork-runtime-private/server/lib/agent/types";

export { registerRuntimeProductIntegration } from "./product-host";
export type {
	ResolvedRuntimeContributions,
	RuntimeLearningContribution,
	RuntimeProductAccessDeniedEvent,
	RuntimeProductIntegration,
	RuntimeProductNarratorAdapter,
	RuntimeResolveContext,
} from "./product-host";

export {
	AppError,
	NotFoundError,
	ValidationError,
} from "../../narrafork-runtime-private/server/lib/errors";

export type ToolContext = RuntimeToolContext;
export type ToolResult = RuntimeToolResult;

/** Product tool-risk metadata is deliberately independent of Runtime internals. */
export type RuntimeToolRisk = "read" | "draft-write" | "confirmed-write" | "destructive";

/**
 * Runtime accepts arbitrary tool metadata at execution time; this narrow public
 * contract preserves the product-owned renderer and risk fields without making
 * the product depend on Runtime's private metadata implementation.
 */
export interface RuntimeToolMetadata {
	runtimePluginId?: string;
	runtimeRisk?: RuntimeToolRisk;
	runtimeRenderer?: string;
}

export type ToolDefinition = Omit<RuntimeToolDefinition, "metadata"> & {
	metadata?: RuntimeToolDefinition["metadata"] & RuntimeToolMetadata;
};

export type { NarratorServerMessage } from "../../narrafork-runtime-private/server/websocket/narrator-ws-types";

export {
	getLearningCategories,
	getLearningDoc,
	getLearningDocSummaries,
	searchLearningDocs,
} from "../../narrafork-runtime-private/shared/learning-content";
export type {
	LearningCategory,
	LearningDoc,
	LearningDocSummary,
} from "../../narrafork-runtime-private/shared/learning-content";

export { getDbDir, getDbPath } from "../../narrafork-runtime-private/server/db/connection";
export { db } from "../../narrafork-runtime-private/server/db";
export {
	chapters,
	narratorMessageRefs,
	narratorMessages,
	narrators,
	narratorToolCalls,
	projects,
	users,
} from "../../narrafork-runtime-private/server/db/schema";

export { generateId } from "../../narrafork-runtime-private/server/lib/id";
export { isKiroAvailable } from "../../narrafork-runtime-private/server/lib/kiro-adapter";
export { logger } from "../../narrafork-runtime-private/server/lib/logger";
export { settings } from "../../narrafork-runtime-private/server/lib/settings";
export { FOLLOW_DEFAULT_MODEL } from "../../narrafork-runtime-private/server/lib/settings/provider";
export type {
	McpToolPermission,
	NarraForkSettings,
} from "../../narrafork-runtime-private/server/lib/settings";

/** Product-scoped MCP permission overrides, persisted with trusted project settings. */
export interface ProjectMcpServerOverride {
	serverId: string;
	defaultBehavior?: RuntimeMcpToolPermission["behavior"];
	toolPermissions?: RuntimeMcpToolPermission[];
}

export { requireAdmin } from "../../narrafork-runtime-private/server/middleware/auth";

export {
	loadGlobalPrompt,
	writeGlobalPrompt,
} from "./global-prompt";
export type {
	GlobalPromptCandidate,
	GlobalPromptPathOptions,
	LoadedGlobalPrompt,
} from "./global-prompt";

export {
	createHookSchema,
	createProjectSkillSchema,
	updateHookSchema,
	updateProjectSkillSchema,
} from "../../narrafork-runtime-private/server/lib/validators";

export { hookService } from "../../narrafork-runtime-private/server/services/hook-service";
export type {
	AttentionReason,
	HookEvent,
	HookInput,
	HookResult,
} from "../../narrafork-runtime-private/server/services/hook-service";

export {
	disableRoutineForProject,
	enableRoutineForProject,
	getProjectRoutineStatusesWithOverride,
	resetRoutineForProject,
} from "../../narrafork-runtime-private/server/services/routine-service";
export type {
	ProjectRoutineStatus,
	RoutineStatus,
} from "../../narrafork-runtime-private/server/services/routine-service";

export { skillService } from "../../narrafork-runtime-private/server/services/skill-service";
export type {
	SkillInfo,
	SkillSource,
} from "../../narrafork-runtime-private/server/services/skill-service";

/**
 * Lazy-load project teardown. A static re-export would evaluate
 * chapter/git services during product bootstrap and lock product-host
 * before main.ts can register the NovelFork integration.
 */
export async function deleteProjectById(id: string): Promise<void> {
	const { deleteProjectById: deleteRuntimeProjectById } = await import("./delete-project");
	await deleteRuntimeProjectById(id);
}
