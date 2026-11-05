/**
 * 小说工具套路从「四个分组」改成「一个工具一个」后的一次性档位迁移。
 *
 * 旧版把小说工具分成 novelfork.writing / market / memory-inspect / maintenance 四组，作者可以在
 * 「套路 › 可选工具」或本书覆盖里给整组设档位。分组拆开后这些 id 不再对应任何套路，留着它们
 * 作者的选择就丢了。这里把每一层（Runtime 全局 settings.routines、每个项目的
 * chapterSettings.routines）里对旧组的明确表态展开到组内每个工具的新套路上：
 *
 * - 明确表态 = toolModes 里有合法档位，或出现在旧白名单（常驻）/ 黑名单（手动）里；
 * - 展开走 Runtime 自己的 applyToolRoutineMode，toolModes 与两份旧名单同步；
 * - 该层已经对某个新工具套路单独表过态的，不覆盖；
 * - 展开后删掉旧组 id；这一层从没设过旧组的，一个字都不写。
 *
 * 迁移按层幂等（旧组 id 删掉后再跑是空操作）；成功后在产品库 kv_store 记标记，之后启动直接跳过。
 * 失败只告警、不记标记、不阻断启动，下次启动重试。
 */

import {
	applyToolRoutineMode,
	clearToolRoutineMode,
	db as runtimeDb,
	logger,
	normalizeToolRoutineMode,
	projects,
	type ResolvedRoutineModeConfig,
	type RoutineModeConfig,
	saveSettings,
	settings,
} from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import {
	getNovelToolRoutineId,
	LEGACY_NOVEL_TOOL_ROUTINE_GROUPS,
	type NovelToolRoutineMode,
} from "@vivy1024/novelfork-novel-plugin";

export const LEGACY_TOOL_ROUTINE_MIGRATION_MARKER = "runtime-migration:novel-tool-routines-per-tool:v1";

export interface LegacyToolRoutineLayerMigration<T extends RoutineModeConfig> {
	/**
	 * 迁移后的这一层。有改动时三个模式字段（toolModes 与两份旧名单）由 applyToolRoutineMode 补齐；
	 * 没改动时原样返回入参（未必带这三个字段，调用方只在 changed 时写回）。
	 */
	readonly config: ResolvedRoutineModeConfig<T>;
	/** 这一层是否有改动（没有旧组表态时为 false，调用方不必写回）。 */
	readonly changed: boolean;
	/** 展开了哪些旧组（id → 档位），用于日志与测试。 */
	readonly expanded: Readonly<Record<string, NovelToolRoutineMode>>;
}

/** 这一层对某个套路的明确表态；与 Runtime 读层的规则一致（toolModes 优先，其次白名单、黑名单）。 */
function explicitLayerMode(config: RoutineModeConfig, routineId: string): NovelToolRoutineMode | null {
	const explicit = normalizeToolRoutineMode(config.toolModes?.[routineId]);
	if (explicit) return explicit;
	if (config.enabledRoutines?.includes(routineId)) return "resident";
	if (config.disabledRoutines?.includes(routineId)) return "manual";
	return null;
}

function mentions(config: RoutineModeConfig, routineId: string): boolean {
	return (
		Object.hasOwn(config.toolModes ?? {}, routineId) ||
		Boolean(config.enabledRoutines?.includes(routineId)) ||
		Boolean(config.disabledRoutines?.includes(routineId))
	);
}

/** 迁移一层套路配置（纯函数，不改入参）。 */
export function migrateLegacyToolRoutineLayer<T extends RoutineModeConfig>(
	layer: T | undefined,
): LegacyToolRoutineLayerMigration<T> {
	const original = (layer ?? {}) as T;
	let config: T = original;
	const expanded: Record<string, NovelToolRoutineMode> = {};
	for (const [groupId, toolNames] of Object.entries(LEGACY_NOVEL_TOOL_ROUTINE_GROUPS)) {
		if (!mentions(config, groupId)) continue;
		const mode = explicitLayerMode(config, groupId);
		if (mode) {
			expanded[groupId] = mode;
			for (const toolName of toolNames) {
				const routineId = getNovelToolRoutineId(toolName);
				if (explicitLayerMode(config, routineId)) continue;
				config = applyToolRoutineMode(config, routineId, mode) as T;
			}
		}
		config = clearToolRoutineMode(config, groupId) as T;
	}
	return { config: config as ResolvedRoutineModeConfig<T>, changed: config !== original, expanded };
}

function parseChapterSettings(raw: unknown): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const value = typeof raw === "string" ? JSON.parse(raw) : raw;
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function hasMarker(storage: StorageDatabase): boolean {
	const row = storage.sqlite
		.prepare(`SELECT 1 AS present FROM "kv_store" WHERE "key" = ?`)
		.get(LEGACY_TOOL_ROUTINE_MIGRATION_MARKER);
	return Boolean(row);
}

function writeMarker(storage: StorageDatabase, summary: Record<string, unknown>): void {
	storage.sqlite
		.prepare(
			`INSERT INTO "kv_store" ("key", "value", "updated_at") VALUES (?, ?, ?)
			 ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updated_at" = excluded."updated_at"`,
		)
		.run(LEGACY_TOOL_ROUTINE_MIGRATION_MARKER, JSON.stringify(summary), Date.now());
}

export interface LegacyToolRoutineMigrationResult {
	/** 本次是否实际执行（已有标记时为 false）。 */
	readonly ran: boolean;
	readonly globalChanged: boolean;
	readonly projectsChanged: number;
	readonly failed: boolean;
}

/** 迁移 Runtime 全局设置层；有改动才写回 settings.json。 */
function migrateGlobalLayer(): boolean {
	const migrated = migrateLegacyToolRoutineLayer(settings.routines as RoutineModeConfig | undefined);
	if (!migrated.changed) return false;
	saveSettings({ ...settings, routines: { ...settings.routines, ...migrated.config } });
	logger.info("Migrated legacy novel tool routine modes (global)", { expanded: migrated.expanded });
	return true;
}

/** 迁移每个 Runtime 项目的覆盖层；与 Runtime 的 routine-service 一样把 chapterSettings 存成 JSON 文本。 */
async function migrateProjectLayers(): Promise<number> {
	const rows: Array<{ id: string; chapterSettings: unknown }> = await runtimeDb
		.select({ id: projects.id, chapterSettings: projects.chapterSettings })
		.from(projects);
	let changed = 0;
	for (const row of rows) {
		const chapterSettings = parseChapterSettings(row.chapterSettings);
		if (!chapterSettings || !chapterSettings.routines || typeof chapterSettings.routines !== "object") continue;
		const migrated = migrateLegacyToolRoutineLayer(chapterSettings.routines as RoutineModeConfig);
		if (!migrated.changed) continue;
		await runtimeDb
			.update(projects)
			.set({
				chapterSettings: JSON.stringify({ ...chapterSettings, routines: migrated.config }),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(projects.id, row.id));
		logger.info("Migrated legacy novel tool routine modes (project)", {
			projectId: row.id,
			expanded: migrated.expanded,
		});
		changed += 1;
	}
	return changed;
}

export async function migrateLegacyNovelToolRoutines(
	storage: StorageDatabase,
): Promise<LegacyToolRoutineMigrationResult> {
	if (hasMarker(storage)) return { ran: false, globalChanged: false, projectsChanged: 0, failed: false };
	let globalChanged = false;
	let projectsChanged = 0;
	try {
		globalChanged = migrateGlobalLayer();
		projectsChanged = await migrateProjectLayers();
		writeMarker(storage, { globalChanged, projectsChanged });
		return { ran: true, globalChanged, projectsChanged, failed: false };
	} catch (error) {
		logger.warn("Could not migrate legacy novel tool routine modes; will retry next startup", {
			error: String(error),
		});
		return { ran: true, globalChanged, projectsChanged, failed: true };
	}
}
