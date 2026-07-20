import {
	AppError,
	createHookSchema,
	createProjectSkillSchema,
	loadGlobalPrompt,
	NotFoundError,
	type McpToolPermission,
	type ProjectMcpServerOverride,
	type SkillInfo,
	updateHookSchema,
	updateProjectSkillSchema,
	ValidationError,
	writeGlobalPrompt,
} from "@vivy1024/narrafork-runtime-bridge";
import { Hono } from "hono";
import { z } from "zod/v4";
import type {
	BookRuntimeAccessActor,
	TrustedBookRuntimeAccess,
} from "../services/book-runtime-access";

export interface ProjectRoutineConfig {
	disabledRoutines?: string[];
	enabledRoutines?: string[];
}

export interface ProjectMcpConfig {
	mcpServerOverrides?: ProjectMcpServerOverride[];
}

export interface ProjectMcpOverridePatch {
	defaultBehavior?: ProjectMcpServerOverride["defaultBehavior"] | null;
	toolPermissionPatch?: {
		toolName: string;
		behavior?: McpToolPermission["behavior"] | null;
		enabled?: boolean;
	};
}

export type BookHookRecord = {
	id: string;
	projectId: string | null;
	event: string;
	matcher: string;
	type: string;
	command: string | null;
	url: string | null;
	headers: Record<string, string> | null;
	proxyMode: string | null;
	proxyUrl: string | null;
	timeout: number;
	enabled: boolean;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
};

export interface BookRuntimeCapabilitiesRouteDeps {
	resolveAccess(bookId: string, actor: BookRuntimeAccessActor): Promise<TrustedBookRuntimeAccess>;
	getProjectRoutineConfig(projectId: string): Promise<ProjectRoutineConfig | undefined>;
	getProjectMcpOverrides(projectId: string): Promise<ProjectMcpServerOverride[]>;
	updateProjectMcpOverride(
		projectId: string,
		serverId: string,
		patch: ProjectMcpOverridePatch,
	): Promise<ProjectMcpServerOverride[]>;
	hasMcpServer(serverId: string): boolean;
	routines: {
		enable(routineId: string, projectId: string): Promise<void>;
		disable(routineId: string, projectId: string): Promise<void>;
		reset(routineId: string, projectId: string): Promise<void>;
		statuses(config?: ProjectRoutineConfig): unknown[];
	};
	skills: {
		loadProjectSkills(projectRoot: string): Promise<SkillInfo[]>;
		loadProjectSkillByName(projectRoot: string, name: string): Promise<SkillInfo | null>;
		createProjectSkill(
			projectRoot: string,
			name: string,
			description: string,
			content: string,
		): Promise<SkillInfo>;
		updateProjectSkill(
			projectRoot: string,
			currentName: string,
			name: string,
			description: string,
			content: string,
		): Promise<SkillInfo>;
		deleteProjectSkill(projectRoot: string, name: string): Promise<void>;
	};
	hooks: {
		list(projectId?: string | null): Promise<BookHookRecord[]>;
		get(id: string): Promise<BookHookRecord | null>;
		create(data: z.infer<typeof createHookSchema>): Promise<BookHookRecord | null>;
		update(id: string, data: z.infer<typeof updateHookSchema>): Promise<BookHookRecord | null>;
		delete(id: string): Promise<void>;
	};
}

export function parseProjectRoutines(raw: unknown): ProjectRoutineConfig | undefined {
	try {
		const settings = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined;
		const routines = (settings as { routines?: unknown }).routines;
		return routines && typeof routines === "object" && !Array.isArray(routines)
			? (routines as ProjectRoutineConfig)
			: undefined;
	} catch {
		return undefined;
	}
}

export function parseProjectSettings(raw: unknown): Record<string, unknown> {
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? { ...(parsed as Record<string, unknown>) }
			: {};
	} catch {
		return {};
	}
}

export function parseProjectMcpOverrides(raw: unknown): ProjectMcpServerOverride[] {
	const candidates = parseProjectSettings(raw).mcpServerOverrides;
	if (!Array.isArray(candidates)) return [];
	return candidates.filter((candidate): candidate is ProjectMcpServerOverride => (
		candidate !== null &&
		typeof candidate === "object" &&
		!Array.isArray(candidate) &&
		typeof (candidate as { serverId?: unknown }).serverId === "string"
	));
}

export function applyProjectMcpOverridePatch(
	raw: unknown,
	serverId: string,
	patch: ProjectMcpOverridePatch,
): Record<string, unknown> {
	const projectSettings = parseProjectSettings(raw);
	const overrides = parseProjectMcpOverrides(projectSettings).map((override) => ({ ...override }));
	const index = overrides.findIndex((override) => override.serverId === serverId);
	const current: ProjectMcpServerOverride = index >= 0 ? overrides[index] : { serverId };
	const updated: ProjectMcpServerOverride = {
		...current,
		toolPermissions: current.toolPermissions?.map((permission) => ({ ...permission })),
	};

	if (Object.hasOwn(patch, "defaultBehavior")) {
		if (patch.defaultBehavior == null) delete updated.defaultBehavior;
		else updated.defaultBehavior = patch.defaultBehavior;
	}
	if (patch.toolPermissionPatch) {
		const rules = [...(updated.toolPermissions ?? [])];
		const ruleIndex = rules.findIndex((rule) => rule.toolName === patch.toolPermissionPatch?.toolName);
		if (patch.toolPermissionPatch.behavior === null) {
			if (ruleIndex >= 0) rules.splice(ruleIndex, 1);
		} else if (patch.toolPermissionPatch.behavior === undefined) {
			if (ruleIndex >= 0 && patch.toolPermissionPatch.enabled !== undefined) {
				rules[ruleIndex] = { ...rules[ruleIndex], enabled: patch.toolPermissionPatch.enabled };
			}
		} else {
			const rule: McpToolPermission = {
				...(ruleIndex >= 0 ? rules[ruleIndex] : {}),
				toolName: patch.toolPermissionPatch.toolName,
				behavior: patch.toolPermissionPatch.behavior,
				...(patch.toolPermissionPatch.enabled !== undefined
					? { enabled: patch.toolPermissionPatch.enabled }
					: {}),
			};
			if (ruleIndex >= 0) rules[ruleIndex] = rule;
			else rules.push(rule);
		}
		if (rules.length > 0) updated.toolPermissions = rules;
		else delete updated.toolPermissions;
	}

	const hasOverride = updated.defaultBehavior !== undefined || (updated.toolPermissions?.length ?? 0) > 0;
	if (hasOverride) {
		if (index >= 0) overrides[index] = updated;
		else overrides.push(updated);
	} else if (index >= 0) {
		overrides.splice(index, 1);
	}

	if (overrides.length > 0) projectSettings.mcpServerOverrides = overrides;
	else delete projectSettings.mcpServerOverrides;
	return projectSettings;
}

const routineActionSchema = z.object({ action: z.enum(["enable", "disable", "reset"]) }).strict();
const mcpBehaviorSchema = z.enum(["readOnly", "readWrite", "ask", "deny"]);
const projectMcpOverridePatchSchema = z.object({
	defaultBehavior: mcpBehaviorSchema.nullable().optional(),
	toolPermissionPatch: z.object({
		toolName: z.string().min(1).max(200),
		behavior: mcpBehaviorSchema.nullable().optional(),
		enabled: z.boolean().optional(),
	}).strict().optional(),
}).strict().refine(
	(value) => Object.hasOwn(value, "defaultBehavior") || value.toolPermissionPatch !== undefined,
	"At least one MCP override field is required",
);
const bookPromptWriteSchema = z.object({
	content: z.string().max(50_000),
	filePath: z.string().optional(),
}).strict();

function actor(c: {
	get: (key: "user") => { sub: string; role: "admin" | "user" };
}): BookRuntimeAccessActor {
	const user = c.get("user");
	return { userId: user.sub, role: user.role };
}

function requiredParam(
	c: { req: { param: (name: string) => string | undefined } },
	name: string,
): string {
	const value = c.req.param(name);
	if (!value) throw new ValidationError(`${name} is required`);
	return value;
}

function assertAdmin(currentActor: BookRuntimeAccessActor): void {
	if (currentActor.role !== "admin") {
		throw new AppError("Admin access required", 403, "FORBIDDEN");
	}
}

function toBookSkillSummary(skill: SkillInfo) {
	return {
		name: skill.name,
		description: skill.description,
		location: "book" as const,
		files: skill.files,
		disabled: skill.disabled ?? false,
	};
}

function toBookSkill(skill: SkillInfo) {
	return { ...toBookSkillSummary(skill), content: skill.content };
}

function toBookHook(hook: BookHookRecord) {
	return {
		id: hook.id,
		event: hook.event,
		matcher: hook.matcher,
		type: hook.type,
		command: hook.command,
		url: hook.url,
		headers: hook.headers,
		proxyMode: hook.proxyMode,
		proxyUrl: hook.proxyUrl,
		timeout: hook.timeout,
		enabled: hook.enabled,
		sortOrder: hook.sortOrder,
		createdAt: hook.createdAt,
		updatedAt: hook.updatedAt,
	};
}

function assertHookProject(
	hook: BookHookRecord | null,
	hookId: string,
	projectId: string,
): BookHookRecord {
	if (!hook || hook.projectId !== projectId) throw new NotFoundError("Hook", hookId);
	return hook;
}

function validateHookUpdateState(
	existing: BookHookRecord,
	data: { type?: "command" | "http"; command?: string | null; url?: string | null },
): void {
	const effectiveType = data.type ?? existing.type;
	if (effectiveType === "command" && data.command === null) {
		throw new ValidationError(
			"Cannot clear command without changing hook type — the hook would have no command to execute",
		);
	}
	if (effectiveType === "http" && data.url === null) {
		throw new ValidationError(
			"Cannot clear url without changing hook type — the hook would have no URL to call",
		);
	}
}

export function createBookRuntimeCapabilitiesRoutes(deps: BookRuntimeCapabilitiesRouteDeps): Hono {
	const routes = new Hono();

	routes.get("/routines", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const config = await deps.getProjectRoutineConfig(access.runtimeProjectId);
		return c.json({ routines: deps.routines.statuses(config) });
	});

	routes.put("/routines/:routineId", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const parsed = routineActionSchema.safeParse(await c.req.json());
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		const routineId = requiredParam(c, "routineId");
		await deps.routines[parsed.data.action](routineId, access.runtimeProjectId);
		return c.json({ ok: true });
	});

	routes.get("/mcp", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		return c.json({ serverOverrides: await deps.getProjectMcpOverrides(access.runtimeProjectId) });
	});

	routes.put("/mcp/servers/:serverId", async (c) => {
		const currentActor = actor(c);
		assertAdmin(currentActor);
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), currentActor);
		const serverId = requiredParam(c, "serverId");
		if (!deps.hasMcpServer(serverId)) throw new NotFoundError("MCP server", serverId);
		const parsed = projectMcpOverridePatchSchema.safeParse(await c.req.json());
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		return c.json({
			serverOverrides: await deps.updateProjectMcpOverride(
				access.runtimeProjectId,
				serverId,
				parsed.data,
			),
		});
	});

	routes.get("/skills", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const skills = await deps.skills.loadProjectSkills(access.bookRoot);
		return c.json(skills.map(toBookSkillSummary));
	});

	routes.get("/skills/:name", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const name = requiredParam(c, "name");
		const skill = await deps.skills.loadProjectSkillByName(access.bookRoot, name);
		if (!skill) throw new NotFoundError("Skill", name);
		return c.json(toBookSkill(skill));
	});

	routes.post("/skills", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const parsed = createProjectSkillSchema.safeParse(await c.req.json());
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		const skill = await deps.skills.createProjectSkill(
			access.bookRoot,
			parsed.data.name.trim(),
			parsed.data.description.trim(),
			parsed.data.content.trim(),
		);
		return c.json(toBookSkill(skill), 201);
	});

	routes.put("/skills/:name", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const currentName = requiredParam(c, "name");
		const parsed = updateProjectSkillSchema.safeParse(await c.req.json());
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		const skill = await deps.skills.updateProjectSkill(
			access.bookRoot,
			currentName,
			parsed.data.name?.trim() || currentName,
			parsed.data.description.trim(),
			parsed.data.content.trim(),
		);
		return c.json(toBookSkill(skill));
	});

	routes.delete("/skills/:name", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		await deps.skills.deleteProjectSkill(access.bookRoot, requiredParam(c, "name"));
		return c.json({ ok: true });
	});

	// Project instructions use the trusted book root resolved above. The client
	// only supplies bookId; it never constructs or receives a filesystem root.
	routes.get("/rules", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		return c.json(await loadGlobalPrompt({ repositoryRoot: access.bookRoot }));
	});

	routes.put("/rules", async (c) => {
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), actor(c));
		const parsed = bookPromptWriteSchema.safeParse(await c.req.json());
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		const filePath = await writeGlobalPrompt(parsed.data.content, parsed.data.filePath, {
			repositoryRoot: access.bookRoot,
		});
		return c.json({ ok: true, filePath });
	});

	routes.get("/hooks", async (c) => {
		const currentActor = actor(c);
		assertAdmin(currentActor);
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), currentActor);
		return c.json((await deps.hooks.list(access.runtimeProjectId)).map(toBookHook));
	});

	routes.post("/hooks", async (c) => {
		const currentActor = actor(c);
		assertAdmin(currentActor);
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), currentActor);
		const body: unknown = await c.req.json();
		if (
			body &&
			typeof body === "object" &&
			!Array.isArray(body) &&
			Object.hasOwn(body, "projectId")
		) {
			throw new ValidationError("projectId is server-controlled for book hooks");
		}
		const parsed = createHookSchema.safeParse({
			...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
			projectId: access.runtimeProjectId,
		});
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		const hook = await deps.hooks.create(parsed.data);
		if (!hook) throw new AppError("Failed to create hook", 500);
		return c.json(toBookHook(assertHookProject(hook, hook.id, access.runtimeProjectId)), 201);
	});

	routes.put("/hooks/:hookId", async (c) => {
		const currentActor = actor(c);
		assertAdmin(currentActor);
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), currentActor);
		const hookId = requiredParam(c, "hookId");
		const existing = assertHookProject(
			await deps.hooks.get(hookId),
			hookId,
			access.runtimeProjectId,
		);
		const parsed = updateHookSchema.safeParse(await c.req.json());
		if (!parsed.success) throw new ValidationError(parsed.error.message);
		validateHookUpdateState(existing, parsed.data);
		const hook = await deps.hooks.update(hookId, parsed.data);
		return c.json(toBookHook(assertHookProject(hook, hookId, access.runtimeProjectId)));
	});

	routes.delete("/hooks/:hookId", async (c) => {
		const currentActor = actor(c);
		assertAdmin(currentActor);
		const access = await deps.resolveAccess(requiredParam(c, "bookId"), currentActor);
		const hookId = requiredParam(c, "hookId");
		assertHookProject(await deps.hooks.get(hookId), hookId, access.runtimeProjectId);
		await deps.hooks.delete(hookId);
		return c.json({ ok: true });
	});

	return routes;
}
