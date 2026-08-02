import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import {
	applyProjectMcpOverridePatch,
	type BookHookRecord,
	type BookRuntimeCapabilitiesRouteDeps,
	createBookRuntimeCapabilitiesRoutes,
	parseProjectMcpOverrides,
} from "./runtime-capabilities";

const BOOK_ROOT = "/trusted/books/book-a";
const PROJECT_ID = "project-a";
const NOW = "2026-01-01T00:00:00.000Z";

function hookRecord(projectId: string | null = PROJECT_ID): BookHookRecord {
	return {
		id: "hook-a",
		projectId,
		event: "Stop",
		matcher: "",
		type: "command",
		command: "notify",
		url: null,
		headers: null,
		proxyMode: null,
		proxyUrl: null,
		timeout: 30,
		enabled: true,
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

let routineCalls: Array<{ action: string; routineId: string; projectId: string }>;
let skillRoots: string[];
let hookCreates: Array<Record<string, unknown>>;
let hookUpdates: string[];
let hookDeletes: string[];
let currentHook: ReturnType<typeof hookRecord> | null;
let projectSettings: Record<string, unknown>;
let accessCalls: number;
let deps: BookRuntimeCapabilitiesRouteDeps;

beforeEach(() => {
	routineCalls = [];
	skillRoots = [];
	hookCreates = [];
	hookUpdates = [];
	hookDeletes = [];
	currentHook = hookRecord();
	projectSettings = {
		mcpServerOverrides: [{
			serverId: "memory-server",
			defaultBehavior: "ask",
			toolPermissions: [{ toolName: "recall", behavior: "readOnly" }],
		}],
	};
	accessCalls = 0;
	deps = {
		resolveAccess: async () => {
			accessCalls += 1;
			return { runtimeProjectId: PROJECT_ID, bookRoot: BOOK_ROOT };
		},
		getProjectRoutineConfig: async () => ({ enabledRoutines: ["brainstorm"] }),
		getProjectMcpOverrides: async () => parseProjectMcpOverrides(projectSettings),
		updateProjectMcpOverride: async (_projectId, serverId, patch) => {
			projectSettings = applyProjectMcpOverridePatch(projectSettings, serverId, patch);
			return parseProjectMcpOverrides(projectSettings);
		},
		hasMcpServer: (serverId) => serverId === "memory-server",
		routines: {
			enable: async (routineId, projectId) => {
				routineCalls.push({ action: "enable", routineId, projectId });
			},
			disable: async (routineId, projectId) => {
				routineCalls.push({ action: "disable", routineId, projectId });
			},
			reset: async (routineId, projectId) => {
				routineCalls.push({ action: "reset", routineId, projectId });
			},
			statuses: () => [],
		},
		skills: {
			loadProjectSkills: async (root) => {
				skillRoots.push(root);
				return [
					{
						name: "book-skill",
						description: "Book skill",
						location: `${root}/.narrafork/skills/book-skill/SKILL.md`,
						content: "content",
						files: ["notes.md"],
					},
				];
			},
			loadProjectSkillByName: async (root, name) => {
				skillRoots.push(root);
				return {
					name,
					description: "Book skill",
					location: `${root}/.narrafork/skills/${name}/SKILL.md`,
					content: "content",
					files: [],
				};
			},
			createProjectSkill: async (root, name, description, content) => {
				skillRoots.push(root);
				return {
					name,
					description,
					content,
					location: `${root}/.narrafork/skills/${name}/SKILL.md`,
					files: [],
				};
			},
			updateProjectSkill: async (root, _currentName, name, description, content) => {
				skillRoots.push(root);
				return {
					name,
					description,
					content,
					location: `${root}/.narrafork/skills/${name}/SKILL.md`,
					files: [],
				};
			},
			deleteProjectSkill: async (root) => {
				skillRoots.push(root);
			},
		},
		hooks: {
			list: async () => (currentHook ? [currentHook] : []),
			get: async () => currentHook,
			create: async (data) => {
				hookCreates.push(data as unknown as Record<string, unknown>);
				currentHook = hookRecord(data.projectId ?? null);
				return currentHook;
			},
			update: async (id, data) => {
				hookUpdates.push(id);
				currentHook = currentHook ? { ...currentHook, ...data, updatedAt: NOW } : null;
				return currentHook;
			},
			delete: async (id) => {
				hookDeletes.push(id);
				currentHook = null;
			},
		},
	};
});

function appFor(role: "admin" | "user") {
	const app = new Hono<{
		Variables: { user: { sub: string; role: "admin" | "user" } };
	}>();
	app.use("*", async (c, next) => {
		c.set("user", { sub: role === "admin" ? "admin-a" : "owner-a", role } as never);
		await next();
	});
	app.route("/api/books/:bookId", createBookRuntimeCapabilitiesRoutes(deps));
	app.onError((error, c) => {
		if (error instanceof AppError) {
			return c.json({ error: error.message, code: error.code }, error.statusCode as never);
		}
		return c.json({ error: String(error) }, 500);
	});
	return app;
}

function jsonRequest(method: string, body: unknown): RequestInit {
	return {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

describe("NovelFork book Runtime capability routes", () => {
	test("injects the trusted Runtime project id into routine mutations", async () => {
		const response = await appFor("user").request(
			"/api/books/book-a/routines/brainstorm",
			jsonRequest("PUT", { action: "enable" }),
		);

		expect(response.status).toBe(200);
		expect(routineCalls).toEqual([
			{ action: "enable", routineId: "brainstorm", projectId: PROJECT_ID },
		]);
	});

	test("reads book MCP overrides and removes the final override when inheritance is restored", async () => {
		const app = appFor("admin");
		const list = await app.request("/api/books/book-a/mcp");
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({
			serverOverrides: [{
				serverId: "memory-server",
				defaultBehavior: "ask",
				toolPermissions: [{ toolName: "recall", behavior: "readOnly" }],
			}],
		});

		const clearServer = await app.request(
			"/api/books/book-a/mcp/servers/memory-server",
			jsonRequest("PUT", { defaultBehavior: null }),
		);
		expect(clearServer.status).toBe(200);
		expect((await clearServer.json()).serverOverrides).toEqual([
			{
				serverId: "memory-server",
				toolPermissions: [{ toolName: "recall", behavior: "readOnly" }],
			},
		]);

		const clearTool = await app.request(
			"/api/books/book-a/mcp/servers/memory-server",
			jsonRequest("PUT", {
				toolPermissionPatch: { toolName: "recall", behavior: null },
			}),
		);
		expect(clearTool.status).toBe(200);
		expect(await clearTool.json()).toEqual({ serverOverrides: [] });
		expect(projectSettings).not.toHaveProperty("mcpServerOverrides");
	});

	test("requires administrators and a registered global server for book MCP mutations", async () => {
		const forbidden = await appFor("user").request(
			"/api/books/book-a/mcp/servers/memory-server",
			jsonRequest("PUT", { defaultBehavior: "deny" }),
		);
		expect(forbidden.status).toBe(403);

		const missing = await appFor("admin").request(
			"/api/books/book-a/mcp/servers/missing-server",
			jsonRequest("PUT", { defaultBehavior: "deny" }),
		);
		expect(missing.status).toBe(404);
	});

	test("uses the trusted book root and removes absolute skill locations", async () => {
		const app = appFor("user");
		const listResponse = await app.request("/api/books/book-a/skills");
		const createResponse = await app.request(
			"/api/books/book-a/skills",
			jsonRequest("POST", {
				name: "new-skill",
				description: "New skill",
				content: "Use it",
			}),
		);

		expect(listResponse.status).toBe(200);
		expect(createResponse.status).toBe(201);
		expect(skillRoots).toEqual([BOOK_ROOT, BOOK_ROOT]);
		const listText = await listResponse.text();
		const createText = await createResponse.text();
		expect(listText).not.toContain(BOOK_ROOT);
		expect(createText).not.toContain(BOOK_ROOT);
		expect(JSON.parse(listText)[0].location).toBe("book");
		expect(JSON.parse(createText).location).toBe("book");
	});

	test("requires administrators for all book Hook operations", async () => {
		const response = await appFor("user").request("/api/books/book-a/hooks");
		expect(response.status).toBe(403);
		expect(accessCalls).toBe(0);
	});

	test("rejects client projectId and otherwise injects it without exposing it", async () => {
		const app = appFor("admin");
		const rejected = await app.request(
			"/api/books/book-a/hooks",
			jsonRequest("POST", {
				projectId: "attacker-project",
				event: "Stop",
				type: "command",
				command: "notify",
			}),
		);
		const created = await app.request(
			"/api/books/book-a/hooks",
			jsonRequest("POST", { event: "Stop", type: "command", command: "notify" }),
		);

		expect(rejected.status).toBe(400);
		expect(created.status).toBe(201);
		expect(hookCreates).toHaveLength(1);
		expect(hookCreates[0].projectId).toBe(PROJECT_ID);
		const payload = await created.json();
		expect(payload).not.toHaveProperty("projectId");
	});

	test("prevents Hook update and delete across Runtime projects", async () => {
		currentHook = hookRecord("other-project");
		const app = appFor("admin");
		const update = await app.request(
			"/api/books/book-a/hooks/hook-a",
			jsonRequest("PUT", { enabled: false }),
		);
		const remove = await app.request("/api/books/book-a/hooks/hook-a", { method: "DELETE" });

		expect(update.status).toBe(404);
		expect(remove.status).toBe(404);
		expect(hookUpdates).toEqual([]);
		expect(hookDeletes).toEqual([]);
	});

	test("omits Hook projectId from list responses", async () => {
		const response = await appFor("admin").request("/api/books/book-a/hooks");
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload[0]).not.toHaveProperty("projectId");
	});
});
