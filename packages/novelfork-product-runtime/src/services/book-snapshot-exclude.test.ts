import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookRuntimeBindingRecord } from "./book-binding";
import {
	BOOK_SNAPSHOT_EXCLUDE_RELATIVE_PATH,
	ensureBookSnapshotExclude,
	reconcileBookSnapshotExcludes,
	renderBookSnapshotExclude,
} from "./book-snapshot-exclude";

const dirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
	const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/**
 * 建出这些文件，再用 git 自己的规则列出被排除的那些
 * （Runtime 快照把本文件并进影子库的 info/exclude，与 --exclude-from 同一语义）。
 */
async function ignoredBy(root: string, paths: readonly string[]): Promise<Set<string>> {
	for (const path of paths) {
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), "x", "utf8");
	}
	const result = spawnSync(
		"git",
		[
			"-c",
			"core.quotePath=false",
			"-C",
			root,
			"ls-files",
			"-o",
			"-i",
			`--exclude-from=${BOOK_SNAPSHOT_EXCLUDE_RELATIVE_PATH}`,
			"-z",
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) throw new Error(result.stderr);
	return new Set(result.stdout.split("\0").filter(Boolean));
}

describe("书根的工作区快照排除规则", () => {
	test("写入默认规则：参考原著、表格、导出稿排除，章节与设定保留", async () => {
		const root = await tempDir("nf-snapshot-exclude-");
		spawnSync("git", ["init", "-q", root]);
		expect(await ensureBookSnapshotExclude(root)).toBe("written");
		const paths = [
			"玄鉴11.6.txt",
			"玄鉴功法境界道基体系/朝代.xlsx",
			"参考/原著.txt",
			"素材/图.png",
			"export/publish/0001.md",
			".novelfork/checkpoints/c1/resources/a.md",
			"chapters/卷01/0001_开篇.md",
			"chapters/附录.txt",
			"story/state/current_state.json",
			"story/notes.txt",
			"book.json",
			".novelfork/skills/a/SKILL.md",
		];
		const ignored = await ignoredBy(root, paths);
		expect([...ignored].sort()).toEqual(
			[
				"玄鉴11.6.txt",
				"玄鉴功法境界道基体系/朝代.xlsx",
				"参考/原著.txt",
				"素材/图.png",
				"export/publish/0001.md",
				".novelfork/checkpoints/c1/resources/a.md",
			].sort(),
		);
	});

	test("幂等；作者去掉标记后视为自己维护，不再改写", async () => {
		const root = await tempDir("nf-snapshot-exclude-owned-");
		expect(await ensureBookSnapshotExclude(root)).toBe("written");
		expect(await ensureBookSnapshotExclude(root)).toBe("unchanged");
		const path = join(root, BOOK_SNAPSHOT_EXCLUDE_RELATIVE_PATH);
		await writeFile(path, "*.txt\n", "utf8");
		expect(await ensureBookSnapshotExclude(root)).toBe("user-owned");
		expect(await readFile(path, "utf8")).toBe("*.txt\n");
		// 旧版本的管理文件会被更新为当前版本。
		await writeFile(path, `${renderBookSnapshotExclude().split("\n")[0]}\n/old/\n`, "utf8");
		expect(await ensureBookSnapshotExclude(root)).toBe("written");
		expect(await readFile(path, "utf8")).toBe(renderBookSnapshotExclude());
	});

	test("启动补写只处理可信书根，缺失的书根跳过", async () => {
		const booksRoot = await tempDir("nf-snapshot-exclude-books-");
		const bookRoot = join(booksRoot, "book-a");
		await mkdir(bookRoot, { recursive: true });
		const binding = (bookId: string, root: string): BookRuntimeBindingRecord => ({
			id: `b-${bookId}`,
			runtimeProjectId: `p-${bookId}`,
			bookId,
			bookRoot: root,
			createdByUserId: null,
			createdAt: "",
			updatedAt: "",
		});
		const result = await reconcileBookSnapshotExcludes(
			[binding("book-a", bookRoot), binding("book-gone", join(booksRoot, "book-gone"))],
			booksRoot,
		);
		expect(result).toEqual({ written: 1, skipped: 1 });
		expect(await readFile(join(bookRoot, BOOK_SNAPSHOT_EXCLUDE_RELATIVE_PATH), "utf8")).toBe(
			renderBookSnapshotExclude(),
		);
	});
});
