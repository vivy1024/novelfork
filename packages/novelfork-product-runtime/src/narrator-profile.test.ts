import { describe, expect, test } from "bun:test";
import {
	isNovelForkProductNarrator,
	resolveNovelForkNarratorCwd,
} from "./narrator-profile";

describe("NovelFork narrator product profile", () => {
	test("recognizes only the product-owned narrator trait", () => {
		expect(isNovelForkProductNarrator(["novelfork-product"])).toBe(true);
		expect(isNovelForkProductNarrator('["novelfork-product"]')).toBe(true);
		expect(isNovelForkProductNarrator(["standalone"])).toBe(false);
	});

	test("keeps a product narrator inside the trusted worktree", () => {
		expect(
			resolveNovelForkNarratorCwd({
				traits: ["novelfork-product"],
				narratorCwd: "/untrusted/saved",
				worktreePath: "/book/root",
				projectGitPath: "/project",
				fallbackCwd: "/home",
			}),
		).toBe("/book/root");
	});

	test("preserves generic Runtime CWD precedence for a non-product narrator", () => {
		expect(
			resolveNovelForkNarratorCwd({
				traits: ["standalone"],
				narratorCwd: "/saved",
				worktreePath: "/worktree",
				projectGitPath: "/project",
				fallbackCwd: "/home",
			}),
		).toBe("/saved");
	});
});
