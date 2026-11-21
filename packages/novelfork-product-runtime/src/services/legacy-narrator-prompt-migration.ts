import { db as runtimeDb, logger, narrators } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { isNovelForkProductNarrator } from "../narrator-profile";
import { NOVELIST_PROMPT } from "./book-provision";

/**
 * 识别产品早期写入的旧版内置系统提示词：
 * 仅匹配以产品默认前缀开头且包含已下线旧工具名的系统提示词，
 * 绝不覆写用户自行定制的叙述者系统提示词。
 */
const LEGACY_TOOL_NAME_PATTERN =
	/\b(?:write_preflight|scene_spec|pipeline_write|chapter_write|rewrite_apply|lore_read|lore_write|lore_\*)\b/u;

export function isLegacyBuiltInNovelistPrompt(prompt: string | null | undefined): boolean {
	if (typeof prompt !== "string") return false;
	const trimmed = prompt.trim();
	if (!trimmed.startsWith("你是 NovelFork 的")) return false;
	return LEGACY_TOOL_NAME_PATTERN.test(trimmed);
}

export interface LegacyNarratorPromptReconciliation {
	readonly upgraded: number;
}

/**
 * 将历史建书留下的旧版内置 NOVELIST_PROMPT（instructions.session）平滑升级到最新版，
 * 避免与 product.novelfork-novel.core 新版工具流产生指令打架。幂等执行。
 */
export async function reconcileLegacyBookNarratorPrompts(): Promise<LegacyNarratorPromptReconciliation> {
	const rows = await runtimeDb
		.select({
			id: narrators.id,
			traits: narrators.traits,
			systemPrompt: narrators.systemPrompt,
		})
		.from(narrators);

	let upgraded = 0;
	const now = new Date().toISOString();
	for (const row of rows) {
		if (!isNovelForkProductNarrator(row.traits)) continue;
		if (!isLegacyBuiltInNovelistPrompt(row.systemPrompt)) continue;
		await runtimeDb
			.update(narrators)
			.set({
				systemPrompt: NOVELIST_PROMPT,
				updatedAt: now,
			})
			.where(eq(narrators.id, row.id));
		upgraded += 1;
	}
	if (upgraded > 0) {
		logger.info("Upgraded legacy NovelFork book narrator system prompts", { upgraded });
	}
	return { upgraded };
}
