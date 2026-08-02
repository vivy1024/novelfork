import {
	db,
	disableRoutineForProject,
	enableRoutineForProject,
	getProjectRoutineStatusesWithOverride,
	hookService,
	NotFoundError,
	projects,
	resetRoutineForProject,
	settings,
	skillService,
} from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { resolveTrustedBookRuntimeAccess } from "../services/book-runtime-access";
import {
	applyProjectMcpOverridePatch,
	type BookRuntimeCapabilitiesRouteDeps,
	createBookRuntimeCapabilitiesRoutes,
	parseProjectMcpOverrides,
	parseProjectRoutines,
} from "./runtime-capabilities";

export const defaultBookRuntimeCapabilitiesRouteDeps: BookRuntimeCapabilitiesRouteDeps = {
	resolveAccess: resolveTrustedBookRuntimeAccess,
	async getProjectRoutineConfig(projectId) {
		const project = await db.query.projects.findFirst({
			where: eq(projects.id, projectId),
			columns: { chapterSettings: true },
		});
		if (!project) throw new NotFoundError("Project", projectId);
		return parseProjectRoutines(project.chapterSettings);
	},
	async getProjectMcpOverrides(projectId) {
		const project = await db.query.projects.findFirst({
			where: eq(projects.id, projectId),
			columns: { chapterSettings: true },
		});
		if (!project) throw new NotFoundError("Project", projectId);
		return parseProjectMcpOverrides(project.chapterSettings);
	},
	async updateProjectMcpOverride(projectId, serverId, patch) {
		const project = await db.query.projects.findFirst({
			where: eq(projects.id, projectId),
			columns: { chapterSettings: true },
		});
		if (!project) throw new NotFoundError("Project", projectId);
		const chapterSettings = applyProjectMcpOverridePatch(project.chapterSettings, serverId, patch);
		await db.update(projects).set({
			chapterSettings,
			updatedAt: new Date().toISOString(),
		}).where(eq(projects.id, projectId));
		return parseProjectMcpOverrides(chapterSettings);
	},
	hasMcpServer(serverId) {
		return (settings.mcpServers ?? []).some((server) => server.id === serverId);
	},
	routines: {
		enable: enableRoutineForProject,
		disable: disableRoutineForProject,
		reset: resetRoutineForProject,
		statuses: getProjectRoutineStatusesWithOverride,
	},
	skills: skillService,
	hooks: hookService,
};

export const bookRuntimeCapabilitiesRoutes = createBookRuntimeCapabilitiesRoutes(
	defaultBookRuntimeCapabilitiesRouteDeps,
);
