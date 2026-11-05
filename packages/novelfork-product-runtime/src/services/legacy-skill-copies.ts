/**
 * 把旧版留在作者数据目录里的「未改动内置技能副本」移出全局技能目录。
 *
 * 2026-08 的写作台技能面板里，对内置技能点「编辑」会先把原文复制到
 * `$NOVELFORK_HOME/skills/<slug>/SKILL.md`（作者副本），再进入编辑。很多副本从未改过；
 * 2026-09-29 起第三方技能移出内置，2026-10 起 Runtime 把这个目录当全局技能扫描，于是这些
 * 旧副本（含过时工具名）以「全局技能」出现在每本书、每个叙述者面前。
 *
 * 判定只认逐字一致：副本 SKILL.md（LF 归一、去首尾空白）的 SHA-256 必须等于同一 slug
 * 历史上某次内置分发的哈希（historical-bundled-skill-hashes.generated.ts）。作者改过一个字
 * 就不动；目录里还有 SKILL.md 以外的文件也不动（可能是作者加的附件）。
 *
 * 不删除：整个目录移到 `$NOVELFORK_HOME/skills-legacy-<YYYYMMDD>/<slug>/`，想恢复就移回去。
 * 成功执行一次后在产品库 kv_store 记标记，之后启动不再扫描；失败只告警、不记标记、不阻断启动。
 *
 * 重新生成哈希表：对 bundled-skills.generated.ts 的每个 git 历史版本，取每个 nf-* 条目
 * `content` 的 sha256(content.replace(/\r\n/g, "\n").trim())。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@vivy1024/narrafork-runtime-bridge";
import { resolveGlobalConfigDir, type StorageDatabase } from "@vivy1024/novelfork-core";
import { HISTORICAL_BUNDLED_SKILL_HASHES } from "./historical-bundled-skill-hashes.generated";

export const LEGACY_SKILL_COPIES_MARKER = "cleanup:legacy-bundled-skill-copies:v1";

export interface LegacySkillCopyCleanupResult {
	/** 本次是否实际扫描（已有标记时为 false）。 */
	readonly scanned: boolean;
	/** 移走的 slug。 */
	readonly moved: readonly string[];
	/** 备份目录；没有移动任何副本时为 null。 */
	readonly backupDir: string | null;
}

export interface LegacySkillCopyCleanupOptions {
	/** 默认为 NOVELFORK_HOME（未设置时为 ~/.novelfork）。 */
	readonly home?: string;
	readonly now?: Date;
	readonly hashes?: Readonly<Record<string, readonly string[]>>;
}

function contentHash(raw: string): string {
	return createHash("sha256").update(raw.replace(/\r\n/g, "\n").trim()).digest("hex");
}

function dateStamp(now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function hasMarker(storage: StorageDatabase): boolean {
	return Boolean(
		storage.sqlite.prepare(`SELECT 1 AS present FROM "kv_store" WHERE "key" = ?`).get(LEGACY_SKILL_COPIES_MARKER),
	);
}

function writeMarker(storage: StorageDatabase, value: unknown): void {
	storage.sqlite
		.prepare(
			`INSERT INTO "kv_store" ("key", "value", "updated_at") VALUES (?, ?, ?)
			 ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updated_at" = excluded."updated_at"`,
		)
		.run(LEGACY_SKILL_COPIES_MARKER, JSON.stringify(value), Date.now());
}

/** 只含一个 SKILL.md、且其内容与该 slug 某次内置分发逐字一致。 */
async function isUntouchedBundledCopy(
	skillDir: string,
	slug: string,
	hashes: Readonly<Record<string, readonly string[]>>,
): Promise<boolean> {
	const known = hashes[slug];
	if (!known || known.length === 0) return false;
	const entries = await readdir(skillDir, { withFileTypes: true });
	if (entries.length !== 1 || !entries[0]?.isFile() || entries[0].name !== "SKILL.md") return false;
	const raw = await readFile(join(skillDir, "SKILL.md"), "utf8");
	return known.includes(contentHash(raw));
}

export async function moveLegacyBundledSkillCopies(
	storage: StorageDatabase,
	options: LegacySkillCopyCleanupOptions = {},
): Promise<LegacySkillCopyCleanupResult> {
	if (hasMarker(storage)) return { scanned: false, moved: [], backupDir: null };
	const home = options.home ?? resolveGlobalConfigDir();
	const hashes = options.hashes ?? HISTORICAL_BUNDLED_SKILL_HASHES;
	const skillsDir = join(home, "skills");
	const moved: string[] = [];
	let backupDir: string | null = null;
	try {
		if (existsSync(skillsDir)) {
			const entries = await readdir(skillsDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory() || !entry.name.startsWith("nf-")) continue;
				const source = join(skillsDir, entry.name);
				if (!(await isUntouchedBundledCopy(source, entry.name, hashes))) continue;
				backupDir ??= join(home, `skills-legacy-${dateStamp(options.now ?? new Date())}`);
				const target = join(backupDir, entry.name);
				// 备份目录里已有同名目录（例如同一天手工恢复后又被移回）时保留原状，不覆盖。
				if (existsSync(target)) continue;
				await mkdir(backupDir, { recursive: true });
				await rename(source, target);
				moved.push(entry.name);
			}
		}
		writeMarker(storage, { moved, backupDir });
		if (moved.length > 0) {
			logger.info("Moved untouched legacy bundled skill copies out of the global skill directory", {
				count: moved.length,
				backupDir,
			});
		}
		return { scanned: true, moved, backupDir };
	} catch (error) {
		logger.warn("Could not move legacy bundled skill copies; will retry next startup", {
			moved: moved.length,
			error: String(error),
		});
		return { scanned: true, moved, backupDir };
	}
}
