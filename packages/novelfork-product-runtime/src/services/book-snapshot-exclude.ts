/**
 * 书根的工作区快照排除规则。
 *
 * Runtime 在每次改文件的工具前后给工作区拍快照（影子 git 树），用来对比「这次调用改了哪些文件」。
 * 它默认收下书根里的一切，作者放进书根的参考原著 txt、表格、导出稿都会跟着进快照库，
 * 一本书就能占掉几十 MB。Runtime（fork）读取 `<书根>/.narrafork/snapshot-exclude`
 * 作为额外的排除规则，语法同 `.gitignore`；这里负责写入产品的默认规则。
 *
 * 只排除不属于写作产物的东西：章节（chapters/）、设定与状态（story/）、book.json 照常进快照。
 * 作者自己 `.gitignore` 里的 `!例外` 仍然优先，被作者 git 跟踪的文件 Runtime 也照收不误。
 *
 * 文件带管理标记：只覆盖本模块写的版本；作者删掉标记行后视为自己维护，不再改写。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "@vivy1024/narrafork-runtime-bridge";
import { type BookRuntimeBindingRecord, resolveTrustedBookRoot } from "./book-binding";

/** 与 Runtime 的 SNAPSHOT_EXCLUDE_RELATIVE_PATH 同一路径。 */
export const BOOK_SNAPSHOT_EXCLUDE_RELATIVE_PATH = join(".narrafork", "snapshot-exclude");

const MANAGED_MARKER = "# novelfork-managed: snapshot-exclude v1";

const BOOK_SNAPSHOT_EXCLUDE_RULES: readonly string[] = [
	// 参考资料与素材目录
	"/参考/",
	"/参考资料/",
	"/素材/",
	"/资料/",
	"/references/",
	"/materials/",
	// 导出、备份
	"/export/",
	"/exports/",
	"/导出/",
	"/backup/",
	"/backups/",
	// 产品自己的缓存（检查点副本、管线运行记录）
	"/.novelfork/checkpoints/",
	"/.novelfork/last-pipeline-run.json",
	"/.novelfork-worktrees/",
	// 参考原著一类的大文本；章节与设定目录里的 txt 例外
	"*.txt",
	"!/chapters/**/*.txt",
	"!/story/**/*.txt",
	// 二进制文档、表格与压缩包
	"*.xlsx",
	"*.xls",
	"*.docx",
	"*.doc",
	"*.pdf",
	"*.epub",
	"*.mobi",
	"*.zip",
	"*.7z",
	"*.rar",
];

export function renderBookSnapshotExclude(): string {
	return [
		MANAGED_MARKER,
		"# NovelFork 写入：这些文件不进工作区快照（只影响「这次改了哪些文件」的对比，不影响文件本身）。",
		"# 章节、设定与 book.json 照常记录。删掉第一行标记后，NovelFork 不再改写本文件。",
		...BOOK_SNAPSHOT_EXCLUDE_RULES,
		"",
	].join("\n");
}

export type BookSnapshotExcludeResult = "written" | "unchanged" | "user-owned" | "failed";

/** 写入（或更新本模块写过的）排除规则；作者自己维护的文件不动。失败只告警，不影响建书与启动。 */
export async function ensureBookSnapshotExclude(bookRoot: string): Promise<BookSnapshotExcludeResult> {
	const path = join(bookRoot, BOOK_SNAPSHOT_EXCLUDE_RELATIVE_PATH);
	const expected = renderBookSnapshotExclude();
	try {
		const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (current === expected) return "unchanged";
		if (current !== null && !current.startsWith(MANAGED_MARKER)) return "user-owned";
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, expected, "utf8");
		return "written";
	} catch (error) {
		logger.warn("Could not write the book snapshot exclude rules", {
			bookRoot,
			error: error instanceof Error ? error.message : String(error),
		});
		return "failed";
	}
}

/**
 * 启动时给已有的书补上规则（幂等）。只处理能解析到的书根；书根缺失的绑定跳过。
 * Runtime 读到新规则后，会在下一次快照时把已收进快照、现在被排除的文件移出快照范围。
 */
export async function reconcileBookSnapshotExcludes(
	bindings: readonly BookRuntimeBindingRecord[],
	booksRoot: string,
): Promise<{ written: number; skipped: number }> {
	let written = 0;
	let skipped = 0;
	for (const binding of bindings) {
		// 与读写书时同一可信判定：受控根下的书，或带外部标记的作者目录。
		const root = await resolveTrustedBookRoot(binding, booksRoot, true);
		if (!root) {
			skipped += 1;
			continue;
		}
		if ((await ensureBookSnapshotExclude(root)) === "written") written += 1;
	}
	if (written > 0) logger.info("Wrote book snapshot exclude rules", { written, skipped });
	return { written, skipped };
}
