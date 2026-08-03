import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadWritingSkills } from "../../../novel-plugin/src/engine/writing-skills/loader";
import { recommendWritingSkills } from "../../../novel-plugin/src/engine/writing-skills/recommend";

/**
 * 建书十一问 → Writing Skills 建议。
 *
 * 这里守两件事：
 * 1. `applyGuidedSetup` 只产出建议，绝不代替作者写 `enabledWritingSkillIds`
 *    （启用的 Skill 正文会注入每一章的 style 通道，属于需作者确认的决定，
 *    且写入必须走 writing-skills.write 以保留 Runtime 权限确认）。
 * 2. 建议本身对真实的十一问答案有意义，而不是空壳。
 */

const SERVICE_SOURCE = readFileSync(
	join(import.meta.dir, "book-provision.ts"),
	"utf8",
);

/** 取 applyGuidedSetup 的函数体（到下一个方法定义为止）。 */
function guidedSetupBody(): string {
	const start = SERVICE_SOURCE.indexOf("async applyGuidedSetup(");
	expect(start).toBeGreaterThan(0);
	const end = SERVICE_SOURCE.indexOf("private async recommendWritingSkillsForGuidedSetup", start);
	expect(end).toBeGreaterThan(start);
	return SERVICE_SOURCE.slice(start, end);
}

/** 去掉注释，只留可执行语句 —— 注释里提到字段名不算写入。 */
function executableOnly(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
		.join("\n");
}

describe("applyGuidedSetup 的 Writing Skills 边界", () => {
	test("产出推荐，但不写入 enabledWritingSkillIds", () => {
		const executable = executableOnly(guidedSetupBody());
		expect(executable).toContain("recommendWritingSkillsForGuidedSetup");
		expect(executable).toContain("recommendedWritingSkills");
		// 启用必须由作者确认后经 writing-skills.write 落库
		expect(executable).not.toContain("enabledWritingSkillIds");
		expect(executable).not.toContain("handleWritingSkillsWrite");
	});

	test("仍然完成建书主产物：book.json 与经纬条目", () => {
		const executable = executableOnly(guidedSetupBody());
		expect(executable).toContain("writeBookConfig");
		expect(executable).toContain("createJingweiEntriesFromGuide");
	});

	test("推荐失败不阻断建书（返回空清单而不是抛错）", () => {
		const start = SERVICE_SOURCE.indexOf("private async recommendWritingSkillsForGuidedSetup");
		const helper = SERVICE_SOURCE.slice(start, start + 900);
		expect(helper).toContain("try {");
		expect(helper).toContain("catch");
		expect(helper).toContain("recommended: []");
	});

	test("GuidedSetupResult 暴露推荐与题材簇给前端", () => {
		const typeStart = SERVICE_SOURCE.indexOf("export type GuidedSetupResult");
		const typeBody = SERVICE_SOURCE.slice(typeStart, SERVICE_SOURCE.indexOf("};", typeStart));
		expect(typeBody).toContain("recommendedWritingSkills");
		expect(typeBody).toContain("matchedGenreCluster");
		expect(typeBody).toContain("reason");
	});
});

describe("十一问答案 → 推荐结果（真实内置 skills）", () => {
	test("玄幻+番茄+重度+零容忍：给出带理由的多能力位推荐", async () => {
		const skills = await loadWritingSkills();
		const result = recommendWritingSkills(
			{
				genre: "玄幻",
				tone: "热血爽文",
				platform: "tomato",
				complexity: "heavy",
				aiTasteLevel: "零容忍（必须过朱雀检测）",
			},
			skills,
		);

		expect(result.recommended.length).toBeGreaterThan(2);
		expect(result.matchedGenreCluster).toBe("异能志怪");
		for (const item of result.recommended) {
			expect(item.reason.trim().length).toBeGreaterThan(0);
		}
		// 平台答案经 mapGuidedPlatform 归一为 "tomato"，推荐要认得这个值
		expect(result.recommended.some((item) => item.kind === "platform")).toBe(true);
	});

	test("未知题材也能给出通用能力位，不返回空", async () => {
		const skills = await loadWritingSkills();
		const result = recommendWritingSkills(
			{ genre: "蒸汽朋克飞艇冒险", complexity: "medium" },
			skills,
		);
		expect(result.matchedGenreCluster).toBeNull();
		expect(result.recommended.length).toBeGreaterThan(0);
	});
});
