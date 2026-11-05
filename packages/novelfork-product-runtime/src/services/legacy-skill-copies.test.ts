import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { HISTORICAL_BUNDLED_SKILL_HASHES } from "./historical-bundled-skill-hashes.generated";
import { LEGACY_SKILL_COPIES_MARKER, moveLegacyBundledSkillCopies } from "./legacy-skill-copies";

/**
 * 旧版「编辑内置技能」会把原文复制进 $NOVELFORK_HOME/skills；从未改过的副本以全局技能出现。
 * 启动清理只移走与历史内置原文逐字一致的副本，作者改过的、带附件的、不认识的一律不动。
 */

const ORIGINAL = "---\nid: nf-probe\nname: 探针\ndescription: \"probe\"\n---\n\n正文\n";
const hashOf = (raw: string) => createHash("sha256").update(raw.replace(/\r\n/g, "\n").trim()).digest("hex");
const HASHES = {
	"nf-untouched": [hashOf(ORIGINAL)],
	"nf-crlf": [hashOf(ORIGINAL)],
	"nf-edited": [hashOf(ORIGINAL)],
	"nf-with-attachment": [hashOf(ORIGINAL)],
};
const NOW = new Date(2026, 10, 5, 12);

let storage: StorageDatabase;
let home: string;

async function writeSkill(slug: string, raw: string, extra?: Record<string, string>): Promise<void> {
	const dir = join(home, "skills", slug);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), raw, "utf8");
	for (const [name, content] of Object.entries(extra ?? {})) {
		await mkdir(join(dir, name, ".."), { recursive: true });
		await writeFile(join(dir, name), content, "utf8");
	}
}

function clearMarker(): void {
	storage.sqlite.prepare(`DELETE FROM "kv_store" WHERE "key" = ?`).run(LEGACY_SKILL_COPIES_MARKER);
}

beforeAll(() => {
	storage = initializeNovelRuntimeStorage();
});

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "legacy-skill-copies-"));
	clearMarker();
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

describe("moveLegacyBundledSkillCopies", () => {
	test("只移走逐字一致的副本，其余原样保留", async () => {
		await writeSkill("nf-untouched", ORIGINAL);
		await writeSkill("nf-crlf", ORIGINAL.replace(/\n/g, "\r\n"));
		await writeSkill("nf-edited", ORIGINAL.replace("正文", "作者改过的正文"));
		await writeSkill("nf-with-attachment", ORIGINAL, { "references/notes.md": "作者附件" });
		await writeSkill("nf-unknown", ORIGINAL);
		await writeSkill("my-own-skill", ORIGINAL);

		const result = await moveLegacyBundledSkillCopies(storage, { home, now: NOW, hashes: HASHES });

		const backupDir = join(home, "skills-legacy-20261105");
		expect(result.scanned).toBe(true);
		expect([...result.moved].sort()).toEqual(["nf-crlf", "nf-untouched"]);
		expect(result.backupDir).toBe(backupDir);
		for (const slug of ["nf-crlf", "nf-untouched"]) {
			expect(existsSync(join(home, "skills", slug))).toBe(false);
			expect(await readFile(join(backupDir, slug, "SKILL.md"), "utf8")).toContain("正文");
		}
		for (const slug of ["nf-edited", "nf-with-attachment", "nf-unknown", "my-own-skill"]) {
			expect(existsSync(join(home, "skills", slug, "SKILL.md"))).toBe(true);
		}
		expect(existsSync(join(home, "skills", "nf-with-attachment", "references", "notes.md"))).toBe(true);
	});

	test("执行一次后记标记，之后启动不再扫描", async () => {
		await writeSkill("nf-untouched", ORIGINAL);
		await moveLegacyBundledSkillCopies(storage, { home, now: NOW, hashes: HASHES });

		await writeSkill("nf-untouched", ORIGINAL);
		const second = await moveLegacyBundledSkillCopies(storage, { home, now: NOW, hashes: HASHES });
		expect(second).toEqual({ scanned: false, moved: [], backupDir: null });
		expect(existsSync(join(home, "skills", "nf-untouched", "SKILL.md"))).toBe(true);
	});

	test("没有技能目录时只记标记、不建备份目录", async () => {
		const result = await moveLegacyBundledSkillCopies(storage, { home, now: NOW, hashes: HASHES });
		expect(result).toEqual({ scanned: true, moved: [], backupDir: null });
		expect(existsSync(join(home, "skills-legacy-20261105"))).toBe(false);
	});

	test("备份目录已有同名副本时不覆盖、原副本留在原处", async () => {
		await writeSkill("nf-untouched", ORIGINAL);
		const existing = join(home, "skills-legacy-20261105", "nf-untouched");
		await mkdir(existing, { recursive: true });
		await writeFile(join(existing, "SKILL.md"), "旧备份", "utf8");

		const result = await moveLegacyBundledSkillCopies(storage, { home, now: NOW, hashes: HASHES });
		expect(result.moved).toEqual([]);
		expect(await readFile(join(existing, "SKILL.md"), "utf8")).toBe("旧备份");
		expect(existsSync(join(home, "skills", "nf-untouched", "SKILL.md"))).toBe(true);
	});

	test("内置哈希表覆盖历史第三方技能与自研技能", () => {
		for (const slug of ["nf-chapter-close-out", "nf-lay--piqie-writing", "nf-lornshrimp--都市悬疑-创建小说正文"]) {
			expect(HISTORICAL_BUNDLED_SKILL_HASHES[slug]?.length ?? 0).toBeGreaterThan(0);
		}
		for (const hashes of Object.values(HISTORICAL_BUNDLED_SKILL_HASHES)) {
			for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
		}
	});
});
