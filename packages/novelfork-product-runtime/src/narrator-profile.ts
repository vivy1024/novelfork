export const NOVELFORK_PRODUCT_NARRATOR_TRAIT = "novelfork-product";

function parseTraits(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
	if (typeof raw !== "string") return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

export function isNovelForkProductNarrator(traits: unknown): boolean {
	return parseTraits(traits).includes(NOVELFORK_PRODUCT_NARRATOR_TRAIT);
}

export interface NovelForkNarratorCwdInput {
	readonly traits: unknown;
	readonly narratorCwd: string | null | undefined;
	readonly worktreePath: string | null | undefined;
	readonly projectGitPath: string | null | undefined;
	readonly fallbackCwd: string;
}

/** Product narrators ignore an arbitrary persisted CWD in favor of their trusted worktree. */
export function resolveNovelForkNarratorCwd(input: NovelForkNarratorCwdInput): string {
	return (isNovelForkProductNarrator(input.traits) ? null : input.narratorCwd)
		?? input.worktreePath
		?? input.projectGitPath
		?? input.fallbackCwd;
}
