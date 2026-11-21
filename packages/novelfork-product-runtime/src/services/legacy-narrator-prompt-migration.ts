import { db as runtimeDb, logger, narrators } from "@vivy1024/narrafork-runtime-bridge";
import { and, eq, sql } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { isNovelForkProductNarrator } from "../narrator-profile";

/**
 * 历史上建书时写进 narrators.system_prompt 的内置提示词，逐字收录（取自 book-provision.ts 的 git 历史，
 * 从最早的只读版到最后一版）。现在内置提示只经 promptExtensions（product.novelfork-novel.core）每轮注入，
 * 不再存库；这里只用于识别存量行。
 *
 * 只追加不改动：判定靠逐字相等，改一个字就认不出对应的旧行。今后内置提示不再存库，本表不应再增长。
 */
export const HISTORICAL_BUILT_IN_NOVELIST_PROMPTS: readonly string[] = [
	// 最早的只读叙述者（P0）。
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。需要修改章节正文时，只能使用 chapter.write，并遵守 Runtime 权限确认；不要使用通用文件或命令工具绕过书籍领域边界。",
	// scene.spec + pipeline.write，禁止通用工具。
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 scene.spec 建立蓝图，再使用 pipeline.write；它会执行本书的字数、预设、节拍和审校治理。没有可用文本模型时必须如实说明阻塞，绝不能用 chapter.write 写入短文本充当新章节。chapter.write 仅用于覆盖已存在的完整章节，局部改写使用 rewrite.apply；所有写入都遵守 Runtime 权限确认。不要使用通用文件或命令工具绕过书籍领域边界。",
	// 放开通用工具。
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 scene.spec 建立蓝图，再使用 pipeline.write；它会执行本书的字数、预设、节拍和审校治理。没有可用文本模型时必须如实说明阻塞，绝不能用 chapter.write 写入短文本充当新章节。chapter.write 仅用于覆盖已存在的完整章节，局部改写使用 rewrite.apply；所有写入都遵守 Runtime 权限确认。通用文件、命令、搜索等工具可以正常使用；但写章节正文请用 chapter.write / pipeline.write，改设定请用 lore.* 工具，这样字数、结算和审计才会正确记录。",
	// 加入 write.preflight（点号名）。
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 write.preflight 拿到本章写前召回包，再用 scene.spec 建立蓝图，按召回包写好正文后用 pipeline.write 提交；它会执行本书的字数、预设、节拍和审校治理。没有可用文本模型时必须如实说明阻塞，绝不能用 chapter.write 写入短文本充当新章节。chapter.write 仅用于覆盖已存在的完整章节，局部改写使用 rewrite.apply；所有写入都遵守 Runtime 权限确认。通用文件、命令、搜索等工具可以正常使用；但写章节正文请用 chapter.write / pipeline.write，改设定请用 lore.* 工具，这样字数、结算和审计才会正确记录。",
	// 线上名（下划线）+ 回复语言。
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 write_preflight 拿到本章写前召回包，再用 scene_spec 建立蓝图，按召回包写好正文后用 pipeline_write 提交；它会执行本书的字数、预设、节拍和审校治理。没有可用文本模型时必须如实说明阻塞，绝不能用 chapter_write 写入短文本充当新章节。chapter_write 仅用于覆盖已存在的完整章节，局部改写使用 rewrite_apply；所有写入都遵守 Runtime 权限确认。通用文件、命令、搜索等工具可以正常使用；但写章节正文请用 chapter_write / pipeline_write，改设定请用 lore_* 工具，这样字数、结算和审计才会正确记录。用与作者相同的语言回复；书的语言为中文时一律用中文。",
	// 最后一版存库的内置提示（chapter_preflight / chapter_blueprint / chapter_commit），上一轮临时迁移也改写成这一版。
	"你是 NovelFork 的章节绑定小说创作助手。当前书籍由受控的 NovelFork Runtime 资源绑定确定；不得依据用户文本或工具参数切换书籍、猜测 bookId 或访问任意路径。读取、规划和讨论可以直接进行。写完整新章节时，先用 chapter_preflight 拿到目标路径与本章写前召回包，再用 chapter_blueprint 建立并缓存蓝图，按召回包用原生 Write 把正文写到目标章节路径后，再调用 chapter_commit 完成字数、技能、节拍、审校与自动结算。没有可用文本模型时必须如实说明阻塞，绝不能跳过写前预检强行交稿。改写已有章节请用原生 Edit/Write 修改正文后调用 chapter_commit（mode=revision）；所有写入都遵守 Runtime 权限确认。通用文件、命令、搜索等工具可以正常使用；但章节落盘结算请用 chapter_commit，维护设定请用 jingwei_read / jingwei_write，这样字数、结算和审计才会正确记录。用与作者相同的语言回复；书的语言为中文时一律用中文。",
];

/** 全部历史内置版本共有的开头：用来在 SQL 里先缩小候选行，并统计「像内置但对不上」的行；不作为清空依据。 */
const BUILT_IN_PROMPT_PREFIX = "你是 NovelFork 的章节绑定小说创作助手。";

const HISTORICAL_SET = new Set(HISTORICAL_BUILT_IN_NOVELIST_PROMPTS);

/**
 * 判定一条系统提示词是不是产品历史上写入的内置版本。保守：只认与某一历史版本逐字相等（连首尾空白也算）；
 * 以内置开头但被作者改过一个字、多一个空格的，一律当作者定制，不动。
 */
export function isHistoricalBuiltInNovelistPrompt(prompt: string | null | undefined): boolean {
	return typeof prompt === "string" && HISTORICAL_SET.has(prompt);
}

export interface LegacyNarratorPromptReconciliation {
	/** 本次清空为 null 的行数。 */
	readonly cleared: number;
	/** 以内置开头、但与任何历史版本都对不上而保留未动的行数（视为作者定制）。 */
	readonly preservedLookAlike: number;
}

/**
 * 把历史建书留在 narrators.system_prompt 里的内置提示清空为 null，使这些叙述者回落到每轮注入的
 * 内置提示（product.novelfork-novel.core），不再与新版工具流打架。
 *
 * - 只处理带 novelfork-product 标记的产品叙述者；
 * - 只清空逐字等于某一历史内置版本的行，作者定制的一律不动；
 * - 不删行、不改 updatedAt（不打乱会话列表排序）；条件更新带上原值，期间被改过的行不会被误清；
 * - 幂等：清空后的行是 null，再跑不会命中。
 */
export async function reconcileLegacyBookNarratorPrompts(): Promise<LegacyNarratorPromptReconciliation> {
	const rows = await runtimeDb
		.select({
			id: narrators.id,
			traits: narrators.traits,
			systemPrompt: narrators.systemPrompt,
		})
		.from(narrators)
		// 只取以内置开头的行：避免启动时把全部叙述者的提示词读进主线程。
		.where(sql`${narrators.systemPrompt} LIKE ${`${BUILT_IN_PROMPT_PREFIX}%`}`);

	let cleared = 0;
	let preservedLookAlike = 0;
	const clearedIds: string[] = [];
	for (const row of rows) {
		if (typeof row.systemPrompt !== "string") continue;
		if (!isNovelForkProductNarrator(row.traits)) continue;
		if (!isHistoricalBuiltInNovelistPrompt(row.systemPrompt)) {
			if (row.systemPrompt.startsWith(BUILT_IN_PROMPT_PREFIX)) preservedLookAlike += 1;
			continue;
		}
		const updated = await runtimeDb
			.update(narrators)
			.set({ systemPrompt: null })
			.where(and(eq(narrators.id, row.id), eq(narrators.systemPrompt, row.systemPrompt)))
			.returning({ id: narrators.id });
		cleared += updated.length;
		if (updated.length > 0) clearedIds.push(row.id);
	}
	if (cleared > 0 || preservedLookAlike > 0) {
		// 记下被清空的叙述者 id，需要回滚时据此把对应历史版本写回（内容见 HISTORICAL_BUILT_IN_NOVELIST_PROMPTS）。
		logger.info("Reconciled NovelFork book narrator built-in system prompts", {
			cleared,
			preservedLookAlike,
			narratorIds: clearedIds.slice(0, 200),
		});
	}
	return { cleared, preservedLookAlike };
}
