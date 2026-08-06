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

import {
	getLearningCategories as getRuntimeLearningCategories,
	getLearningDoc as getRuntimeLearningDoc,
	getLearningDocSummaries as getRuntimeLearningDocSummaries,
	searchLearningDocs as searchRuntimeLearningDocs,
	type LearningCategory,
	type LearningDoc,
	type LearningDocSummary,
} from "../../narrafork-runtime-private/shared/learning-content";
import type { RuntimeLearningContribution } from "./product-host";

export function getLearningCategories(
	localeInput?: string | null,
	contributions?: readonly RuntimeLearningContribution[],
): LearningCategory[] {
	const base = getRuntimeLearningCategories(localeInput);
	if (!contributions) return base;
	const locale = localeInput === "en" ? "en" : "zh-CN";
	const extra: LearningCategory[] = contributions.flatMap((c) =>
		c.categories.map((cat) => ({
			id: cat.id,
			label: typeof cat.label === "string" ? cat.label : cat.label[locale] ?? cat.label["zh-CN"] ?? "",
			title: typeof cat.label === "string" ? cat.label : cat.label[locale] ?? cat.label["zh-CN"] ?? "",
			description: typeof cat.description === "string" ? cat.description : cat.description[locale] ?? cat.description["zh-CN"] ?? "",
		})),
	);
	return [...base, ...extra];
}

export function getLearningDocSummaries(
	localeInput?: string | null,
	contributions?: readonly RuntimeLearningContribution[],
): LearningDocSummary[] {
	const base = getRuntimeLearningDocSummaries(localeInput);
	if (!contributions) return base;
	const locale = localeInput === "en" ? "en" : "zh-CN";
	const extra: LearningDocSummary[] = contributions.flatMap((c) =>
		c.docs.map((doc) => ({
			id: doc.id,
			category: doc.category,
			title: typeof doc.title === "string" ? doc.title : doc.title[locale] ?? doc.title["zh-CN"] ?? "",
			summary: typeof doc.summary === "string" ? doc.summary : doc.summary[locale] ?? doc.summary["zh-CN"] ?? "",
			tags: [...(doc.tags ?? [])],
			routes: [],
			actions: [],
		})),
	);
	return [...base, ...extra];
}

export function searchLearningDocs(
	query: string,
	localeInput?: string | null,
	contributions?: readonly RuntimeLearningContribution[],
): LearningDocSummary[] {
	const base = searchRuntimeLearningDocs(query, localeInput);
	if (!contributions) return base;
	const locale = localeInput === "en" ? "en" : "zh-CN";
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const summaries = getLearningDocSummaries(localeInput, contributions);
	if (terms.length === 0) return summaries;
	return summaries.filter((doc) => {
		const full = getLearningDoc(doc.id, locale, contributions);
		const fullText = full
			? `${full.title} ${full.summary} ${full.tags.join(" ")} ${full.sections.map((s) => `${s.title} ${s.body}`).join(" ")}`
			: `${doc.title} ${doc.summary} ${doc.tags.join(" ")}`;
		const text = fullText.toLowerCase();
		return terms.every((term) => text.includes(term));
	});
}

/** Product wrapper adding support for contributed learning modules. */
export function getLearningDoc(
	id: string,
	localeInput?: string | null,
	contributions?: readonly RuntimeLearningContribution[],
): LearningDoc | null {
	const doc = getRuntimeLearningDoc(id, localeInput);
	if (doc) return doc;
	if (!contributions) return null;
	for (const contribution of contributions) {
		const match = contribution.docs.find((d) => d.id === id);
		if (match) {
			const locale = localeInput === "en" ? "en" : "zh-CN";
			return {
				id: match.id,
				category: match.category,
				title: typeof match.title === "string" ? match.title : match.title[locale] ?? match.title["zh-CN"] ?? "",
				summary: typeof match.summary === "string" ? match.summary : match.summary[locale] ?? match.summary["zh-CN"] ?? "",
				tags: [...(match.tags ?? [])],
				sections: match.sections.map((s) => ({
					title: typeof s.title === "string" ? s.title : s.title[locale] ?? s.title["zh-CN"] ?? "",
					body: typeof s.body === "string" ? s.body : s.body[locale] ?? s.body["zh-CN"] ?? "",
				})),
				workflow: match.workflow ? match.workflow.map((w) => (typeof w === "string" ? w : w[locale] ?? w["zh-CN"] ?? "")) : [],
				bestPractices: match.bestPractices ? match.bestPractices.map((b) => (typeof b === "string" ? b : b[locale] ?? b["zh-CN"] ?? "")) : [],
				pitfalls: match.pitfalls ? match.pitfalls.map((p) => (typeof p === "string" ? p : p[locale] ?? p["zh-CN"] ?? "")) : [],
				agentHints: match.agentHints ? match.agentHints.map((a) => (typeof a === "string" ? a : a[locale] ?? a["zh-CN"] ?? "")) : [],
				actions: [],
			};
		}
	}
	return null;
}
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
