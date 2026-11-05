import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { db as runtimeDb, projects, type RoutineModeConfig, saveSettings, settings } from "@vivy1024/narrafork-runtime-bridge";
import { eq, inArray } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { getNovelToolRoutineId, LEGACY_NOVEL_TOOL_ROUTINE_GROUPS } from "@vivy1024/novelfork-novel-plugin";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import {
	LEGACY_TOOL_ROUTINE_MIGRATION_MARKER,
	migrateLegacyNovelToolRoutines,
	migrateLegacyToolRoutineLayer,
} from "./legacy-tool-routine-migration";

/**
 * 小说工具套路由四个分组改成一个工具一个：作者对旧组设过的档位要原样落到组内每个工具上，
 * 没设过的组什么都不写，旧组 id 迁移后消失，重复执行是空操作。
 */

const inspectTools = LEGACY_NOVEL_TOOL_ROUTINE_GROUPS["novelfork.memory-inspect"];
const maintenanceTools = LEGACY_NOVEL_TOOL_ROUTINE_GROUPS["novelfork.maintenance"];
const marketTools = LEGACY_NOVEL_TOOL_ROUTINE_GROUPS["novelfork.market"];
const writingTools = LEGACY_NOVEL_TOOL_ROUTINE_GROUPS["novelfork.writing"];
const ids = (names: readonly string[]) => names.map(getNovelToolRoutineId);

describe("单层迁移（纯函数）", () => {
	test("toolModes 里的旧组档位展开到组内每个工具，旧名单同步，旧组 id 删除", () => {
		const { config, changed, expanded } = migrateLegacyToolRoutineLayer<RoutineModeConfig>({
			toolModes: { "novelfork.memory-inspect": "resident", terminal: "auto" },
			enabledRoutines: ["novelfork.memory-inspect", "brainstorm"],
			disabledRoutines: [],
		});
		expect(changed).toBe(true);
		expect(expanded).toEqual({ "novelfork.memory-inspect": "resident" });
		for (const id of ids(inspectTools)) {
			expect(config.toolModes[id]).toBe("resident");
			expect(config.enabledRoutines).toContain(id);
			expect(config.disabledRoutines).not.toContain(id);
		}
		expect(config.toolModes["novelfork.memory-inspect"]).toBeUndefined();
		expect(config.enabledRoutines).not.toContain("novelfork.memory-inspect");
		// 与小说无关的表态原样保留。
		expect(config.toolModes.terminal).toBe("auto");
		expect(config.enabledRoutines).toContain("brainstorm");
		// 没表过态的组不写任何新套路。
		for (const id of ids([...writingTools, ...marketTools, ...maintenanceTools])) {
			expect(config.toolModes[id]).toBeUndefined();
			expect(config.enabledRoutines).not.toContain(id);
			expect(config.disabledRoutines).not.toContain(id);
		}
	});

	test("只在旧黑名单里的组按手动展开；auto 不进任何名单", () => {
		const fromList = migrateLegacyToolRoutineLayer<RoutineModeConfig>({ disabledRoutines: ["novelfork.market"] }).config;
		for (const id of ids(marketTools)) {
			expect(fromList.toolModes[id]).toBe("manual");
			expect(fromList.disabledRoutines).toContain(id);
		}
		expect(fromList.disabledRoutines).not.toContain("novelfork.market");

		const auto = migrateLegacyToolRoutineLayer<RoutineModeConfig>({ toolModes: { "novelfork.writing": "auto" } }).config;
		for (const id of ids(writingTools)) {
			expect(auto.toolModes[id]).toBe("auto");
			expect(auto.enabledRoutines).not.toContain(id);
			expect(auto.disabledRoutines).not.toContain(id);
		}
	});

	test("已对单个工具表过态的不被组档位覆盖", () => {
		const own = getNovelToolRoutineId(maintenanceTools[0]!);
		const { config } = migrateLegacyToolRoutineLayer<RoutineModeConfig>({
			toolModes: { "novelfork.maintenance": "resident", [own]: "manual" },
			disabledRoutines: [own],
		});
		expect(config.toolModes[own]).toBe("manual");
		expect(config.disabledRoutines).toContain(own);
		expect(config.enabledRoutines).not.toContain(own);
		expect(config.toolModes[getNovelToolRoutineId(maintenanceTools[1]!)]).toBe("resident");
	});

	test("没有旧组表态时原样返回，不产生任何字段", () => {
		const layer = { toolModes: { terminal: "resident" }, enabledRoutines: ["terminal"] };
		const result = migrateLegacyToolRoutineLayer(layer);
		expect(result.changed).toBe(false);
		expect(result.config as unknown).toBe(layer);
		expect(migrateLegacyToolRoutineLayer(undefined).changed).toBe(false);
	});

	test("迁移后再迁移是空操作", () => {
		const once = migrateLegacyToolRoutineLayer({ toolModes: { "novelfork.maintenance": "resident" } }).config;
		expect(migrateLegacyToolRoutineLayer(once).changed).toBe(false);
	});
});

describe("启动迁移（全局设置 + 项目覆盖 + 标记）", () => {
	const suffix = `${Date.now()}`;
	const migratedProject = `routine-migration-project-${suffix}`;
	const untouchedProject = `routine-migration-plain-${suffix}`;
	const noSettingsProject = `routine-migration-empty-${suffix}`;
	let storage: StorageDatabase;
	const originalRoutines = structuredClone(settings.routines);

	const clearMarker = () =>
		storage.sqlite.prepare(`DELETE FROM "kv_store" WHERE "key" = ?`).run(LEGACY_TOOL_ROUTINE_MIGRATION_MARKER);
	const projectRoutines = async (id: string) => {
		const row = await runtimeDb.query.projects.findFirst({ where: eq(projects.id, id), columns: { chapterSettings: true } });
		const raw = row?.chapterSettings;
		return (typeof raw === "string" ? JSON.parse(raw) : raw) ?? null;
	};

	beforeAll(async () => {
		storage = initializeNovelRuntimeStorage();
		const now = new Date().toISOString();
		await runtimeDb.insert(projects).values([
			{
				id: migratedProject,
				name: "Routine migration",
				chapterSettings: JSON.stringify({
					commands: [{ name: "keep" }],
					routines: { toolModes: { "novelfork.market": "manual" }, disabledRoutines: ["novelfork.market"], enabledRoutines: [] },
				}),
				createdAt: now,
				updatedAt: now,
			},
			{
				id: untouchedProject,
				name: "No novel overrides",
				chapterSettings: JSON.stringify({ routines: { toolModes: { terminal: "resident" }, enabledRoutines: ["terminal"] } }),
				createdAt: now,
				updatedAt: now,
			},
			{ id: noSettingsProject, name: "No settings", createdAt: now, updatedAt: now },
		]);
	});

	beforeEach(() => clearMarker());

	afterAll(async () => {
		clearMarker();
		saveSettings({ ...settings, routines: originalRoutines });
		await runtimeDb.delete(projects).where(inArray(projects.id, [migratedProject, untouchedProject, noSettingsProject]));
	});

	test("展开全局与项目层的旧组档位，未设置的组与项目不动，成功后记标记并跳过", async () => {
		saveSettings({
			...settings,
			routines: {
				...settings.routines,
				toolModes: { "novelfork.memory-inspect": "resident", "novelfork.maintenance": "resident", terminal: "auto" },
				enabledRoutines: ["novelfork.memory-inspect", "novelfork.maintenance"],
				disabledRoutines: [],
			},
		});
		const untouchedBefore = await projectRoutines(untouchedProject);

		const result = await migrateLegacyNovelToolRoutines(storage);
		expect(result).toMatchObject({ ran: true, globalChanged: true, failed: false });
		expect(result.projectsChanged).toBe(1);

		const global = settings.routines!;
		for (const id of ids([...inspectTools, ...maintenanceTools])) {
			expect(global.toolModes?.[id]).toBe("resident");
			expect(global.enabledRoutines).toContain(id);
		}
		for (const id of ids([...writingTools, ...marketTools])) expect(global.toolModes?.[id]).toBeUndefined();
		expect(global.toolModes?.["novelfork.memory-inspect"]).toBeUndefined();
		expect(global.toolModes?.["novelfork.maintenance"]).toBeUndefined();
		expect(global.enabledRoutines).not.toContain("novelfork.maintenance");
		expect(global.toolModes?.terminal).toBe("auto");

		const project = await projectRoutines(migratedProject);
		expect(project.commands).toEqual([{ name: "keep" }]);
		for (const id of ids(marketTools)) {
			expect(project.routines.toolModes[id]).toBe("manual");
			expect(project.routines.disabledRoutines).toContain(id);
		}
		expect(project.routines.toolModes["novelfork.market"]).toBeUndefined();
		expect(project.routines.disabledRoutines).not.toContain("novelfork.market");
		expect(await projectRoutines(untouchedProject)).toEqual(untouchedBefore);
		expect(await projectRoutines(noSettingsProject)).toBeNull();

		// 标记已写：再跑直接跳过，即使有人又写回旧组 id 也不再动。
		saveSettings({ ...settings, routines: { ...settings.routines, toolModes: { ...settings.routines?.toolModes, "novelfork.market": "resident" } } });
		expect(await migrateLegacyNovelToolRoutines(storage)).toMatchObject({ ran: false });
		expect(settings.routines?.toolModes?.["novelfork.market"]).toBe("resident");
	});

	test("没有标记时重跑同样幂等：已迁移的层不再改写", async () => {
		saveSettings({
			...settings,
			routines: { toolModes: { [getNovelToolRoutineId("market.scan")]: "resident" }, enabledRoutines: [], disabledRoutines: [] },
		});
		const result = await migrateLegacyNovelToolRoutines(storage);
		expect(result).toMatchObject({ ran: true, globalChanged: false, projectsChanged: 0, failed: false });
	});
});
