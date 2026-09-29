/**
 * 把本地参考仓库里许可明确的第三方 SKILL.md 装进**作者技能目录**，供作者自己使用。
 *
 * 用法：
 *   bun scripts/import-market-skills.ts --report-only       # 只看会装什么
 *   bun scripts/import-market-skills.ts                     # 装到作者技能目录（默认 <NOVELFORK_HOME>/skills）
 *   bun scripts/import-market-skills.ts --target <目录>      # 装到指定目录
 *   bun scripts/import-market-skills.ts --overwrite         # 覆盖作者目录里已存在的同名技能
 *
 * 前提：仓库根的 `reference-skills/<目录>` 下已有上游仓库的本地检出（该目录被 Git 忽略）。
 *
 * 许可纪律（重要）：
 *
 * 第三方技能一律不随 NovelFork 内置分发——内置只有 `packages/novel-plugin/builtin-skills/`
 * 下的自研技能，本脚本也绝不写进那里。它只处理 `third-party-sources.ts` 中
 * `optional: true` 的来源，即许可证明确允许使用与再分发的仓库。没有许可证（法律默认
 * 保留所有权利）或禁止商用的仓库永远不安装，也没有绕过的开关。每个装入的技能都写入
 * `_source.json` 记录来源与许可，界面据此展示出处。
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { authorWritingSkillsDir } from "../packages/novel-plugin/src/engine/writing-skills/loader";
import {
	OPTIONAL_SKILL_SOURCES,
	THIRD_PARTY_SKILL_SOURCES,
} from "../packages/novel-plugin/src/engine/writing-skills/third-party-sources";

const REFERENCE_ROOT = "reference-skills";

/** 本地检出的布局信息；许可与仓库地址以 third-party-sources.ts 为准，这里不重复登记。 */
interface LocalCheckout {
	readonly slugPrefix: string;
	/** reference-skills 下的目录名 */
	readonly dir: string;
	/** 相对仓库根的 skill 搜索目录；省略则全仓递归找 SKILL.md */
	readonly skillDirs?: ReadonlyArray<string>;
	/** 跳过的 skill 目录名：环境部署、浏览器控制等与写作无关的 */
	readonly skip?: ReadonlyArray<string>;
}

const LOCAL_CHECKOUTS: ReadonlyArray<LocalCheckout> = [
	{
		slugPrefix: "worldwonderer",
		dir: "worldwonderer_oh-story-claudecode",
		skillDirs: ["skills"],
		// browser-cdp / story-setup 是运行环境部署，不是写作方法
		skip: ["browser-cdp", "story-setup"],
	},
	{ slugPrefix: "xinganliu", dir: "XINGANLIU_web-novel-writing-skill" },
	{ slugPrefix: "lay", dir: "LAY-lgtm_novel-writing-framework" },
	{ slugPrefix: "goink", dir: "sigpanic_goink-skills" },
];

interface ImportedSkill {
	readonly slug: string;
	readonly name: string;
	readonly repo: string;
	readonly license: string;
	readonly upstreamPath: string;
}

/**
 * 按 skill 名称推断套路分类。
 *
 * 外部仓库的 frontmatter 没有 `kind`（那是 NovelFork 自定义字段），
 * 若不推断，解析器会把它们全兜底成 `workflow`。规则放在导入脚本里而不是解析器里：
 * 解析器只认显式声明的 kind；这里是导入期的一次性归类，结果写进 SKILL.md 的
 * frontmatter，之后就是显式声明。
 */
const KIND_RULES: ReadonlyArray<readonly [RegExp, string]> = [
	[/输出.*版|多平台|母稿|投稿|签约|分发|平台/, "platform"],
	[/设计标题|标题|内容简介|简介|封面|书评|有话说/, "packaging"],
	[/竞对|分析.*作品|题材定位|深度研究|研究|蒸馏|扫榜/, "research"],
	[/审阅|润色|去ai味|去AI味|优化闭环|回炉|重写|humanizer|slop|renhua/i, "revision"],
	[/黄金三章|开篇|章节开头|开头/, "opening"],
	[/章末钩子|钩子|节奏|节拍|爽点|控制卡/, "pacing"],
	[/人物|角色|传记/, "character"],
	[/大纲|伏笔|线索|事件|案件|故事设定|故事面|冷热线|连续性/, "plot"],
	[/对话|冲突|场景|正文|文风/, "prose"],
	[/初始化|闭环|素材/, "workflow"],
];

/**
 * 排除项：上游仓库里嵌套了整个第三方仓库（如 `taste-skill-main/`），
 * 递归扫描会把与网文写作无关的设计/前端类 skill 一并带进来。
 */
const EXCLUDE_NESTED = [
	/taste-skill-main[\\/]skills[\\/](?!taste-skill)/i,
	/[\\/](brandkit|brutalist-skill|minimalist-skill|soft-skill|stitch-skill|redesign-skill|output-skill|image-to-code-skill|imagegen-frontend-\w+)[\\/]/i,
];

function isExcluded(upstreamPath: string): boolean {
	return EXCLUDE_NESTED.some((pattern) => pattern.test(upstreamPath));
}

function inferKind(skillName: string, dirName: string): string {
	const haystack = `${skillName} ${dirName}`;
	for (const [pattern, kind] of KIND_RULES) {
		if (pattern.test(haystack)) return kind;
	}
	return "workflow";
}

/** 只在 frontmatter 缺 kind 时补上；已有 kind 的原样保留。 */
function annotateFrontmatter(rawInput: string, kind: string): string {
	// 上游文件多为 CRLF；正则按 \n 写，先统一换行再处理，否则匹配不到 frontmatter。
	const raw = rawInput.replace(/\r\n/g, "\n");
	const match = /^(﻿?)---\n([\s\S]*?)\n---/.exec(raw);
	if (!match) return raw;
	const frontmatter = match[2] ?? "";
	if (/^kind:/m.test(frontmatter)) return raw;
	return `${match[1] ?? ""}---\n${frontmatter}\nkind: ${kind}\n---${raw.slice(match[0].length)}`;
}

/** 与历史内置 slug 同形（`nf-<前缀>--<名>`），已有书籍里的副本装回后能重新对上作者目录。 */
function slugify(slugPrefix: string, skillDirName: string): string {
	const base = skillDirName
		.toLowerCase()
		.replace(/[^a-z0-9一-龥-_]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `nf-${slugPrefix}--${base || "skill"}`;
}

function readFrontmatterField(raw: string, field: string): string {
	const match = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(raw);
	if (!match) return "";
	return match[1]!.trim().replace(/^['"]|['"]$/g, "");
}

async function findSkillFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > 6) return;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full, depth + 1);
			} else if (entry.name === "SKILL.md") {
				found.push(full);
			}
		}
	}
	await walk(root, 0);
	return found;
}

/**
 * skill 附件里允许带进来的文件类型。上游 `scripts/*.js` 是 SKILL.md 写成必跑步骤的
 * 确定性本地检查脚本，必须一起导入，否则叙述者照做会报文件不存在。
 */
const COPYABLE_EXTENSIONS = [".md", ".js", ".mjs", ".cjs", ".json", ".txt", ".yaml", ".yml"];

function isCopyableAttachment(name: string): boolean {
	return COPYABLE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * 给导入的 `scripts/` 目录划出 CommonJS 边界：上游脚本用 `require()` 写成，
 * 若落地目录的某个父级 package.json 声明了 `"type": "module"`，脚本会按 ESM 解析而失败。
 */
async function ensureCommonJsBoundary(scriptsDir: string): Promise<void> {
	let entries;
	try {
		entries = await readdir(scriptsDir, { withFileTypes: true });
	} catch {
		return;
	}
	const hasCommonJsScript = entries.some((entry) => entry.isFile() && entry.name.endsWith(".js"));
	if (!hasCommonJsScript) return;
	await writeFile(join(scriptsDir, "package.json"), `{\n  "type": "commonjs"\n}\n`, "utf-8");
}

async function copyDir(from: string, to: string): Promise<number> {
	let count = 0;
	let entries;
	try {
		entries = await readdir(from, { withFileTypes: true });
	} catch {
		return 0;
	}
	await mkdir(to, { recursive: true });
	for (const entry of entries) {
		const src = join(from, entry.name);
		const dst = join(to, entry.name);
		if (entry.isDirectory()) {
			count += await copyDir(src, dst);
		} else if (isCopyableAttachment(entry.name)) {
			await writeFile(dst, await readFile(src, "utf-8"), "utf-8");
			count += 1;
		}
	}
	return count;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function readArgValue(argv: ReadonlyArray<string>, name: string): string | null {
	const index = argv.indexOf(name);
	if (index < 0) return null;
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个目录参数。`);
	return value;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const args = new Set(argv);
	const reportOnly = args.has("--report-only");
	const overwrite = args.has("--overwrite");
	if (args.has("--include-unlicensed")) {
		throw new Error("未声明许可证或禁止商用的来源不提供安装；--include-unlicensed 已移除。");
	}
	const targetRoot = resolve(readArgValue(argv, "--target") ?? authorWritingSkillsDir());

	const sourceByPrefix = new Map(OPTIONAL_SKILL_SOURCES.map((source) => [source.slugPrefix, source]));
	const imported: ImportedSkill[] = [];
	const skippedExisting: string[] = [];
	const seen = new Set<string>();
	const kindTally = new Map<string, number>();

	for (const checkout of LOCAL_CHECKOUTS) {
		const source = sourceByPrefix.get(checkout.slugPrefix);
		if (!source) continue;
		const repoRoot = join(REFERENCE_ROOT, checkout.dir);
		if (!(await exists(repoRoot))) {
			console.warn(`[skip] 找不到本地检出：${repoRoot}（先把 ${source.repo} 检出到这里）`);
			continue;
		}

		const searchRoots = checkout.skillDirs?.map((d) => join(repoRoot, d)) ?? [repoRoot];
		for (const searchRoot of searchRoots) {
			for (const skillFile of await findSkillFiles(searchRoot)) {
				const skillDir = skillFile.slice(0, skillFile.length - "SKILL.md".length - 1);
				const dirName = skillDir.split(sep).pop() ?? "skill";
				if (checkout.skip?.includes(dirName)) continue;

				const raw = await readFile(skillFile, "utf-8");
				const name = readFrontmatterField(raw, "name");
				const description = readFrontmatterField(raw, "description");
				if (!name || !description) {
					console.warn(`[skip] 缺 name/description：${relative(".", skillFile)}`);
					continue;
				}

				const upstreamRel = relative(repoRoot, skillFile).split(sep).join("/");
				if (isExcluded(upstreamRel)) continue;

				let slug = slugify(source.slugPrefix, dirName);
				let dedupe = 2;
				while (seen.has(slug)) slug = `${slugify(source.slugPrefix, dirName)}-${dedupe++}`;
				seen.add(slug);

				const kind = inferKind(name, dirName);
				kindTally.set(kind, (kindTally.get(kind) ?? 0) + 1);

				if (!reportOnly) {
					const target = join(targetRoot, slug);
					if (!overwrite && await exists(join(target, "SKILL.md"))) {
						skippedExisting.push(slug);
						continue;
					}
					await mkdir(target, { recursive: true });
					await writeFile(join(target, "SKILL.md"), annotateFrontmatter(raw, kind), "utf-8");
					await copyDir(join(skillDir, "references"), join(target, "references"));
					const scriptsTarget = join(target, "scripts");
					await copyDir(join(skillDir, "scripts"), scriptsTarget);
					await ensureCommonJsBoundary(scriptsTarget);
					await writeFile(
						join(target, "_source.json"),
						`${JSON.stringify(
							{
								repo: source.repo,
								license: source.license,
								upstreamPath: upstreamRel,
								importedName: name,
							},
							null,
							2,
						)}\n`,
						"utf-8",
					);
				}

				imported.push({
					slug,
					name,
					repo: source.repo,
					license: source.license,
					upstreamPath: upstreamRel,
				});
			}
		}
	}

	console.log(`${reportOnly ? "[report-only] 会装入" : "已装入"} ${imported.length} 个 skill → ${targetRoot}`);
	const byRepo = new Map<string, { count: number; license: string }>();
	for (const skill of imported) {
		const current = byRepo.get(skill.repo);
		byRepo.set(skill.repo, { count: (current?.count ?? 0) + 1, license: skill.license });
	}
	for (const [repo, { count, license }] of byRepo) {
		console.log(`   ${count.toString().padStart(4)} ← ${repo}（${license}）`);
	}
	if (skippedExisting.length > 0) {
		console.log(`\n作者目录已有同名技能，未覆盖 ${skippedExisting.length} 个（需要覆盖时加 --overwrite）。`);
	}

	console.log("\n分类分布：");
	for (const [kind, count] of [...kindTally.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`   ${count.toString().padStart(4)}  ${kind}`);
	}

	const refused = THIRD_PARTY_SKILL_SOURCES.filter((source) => !source.optional);
	if (refused.length > 0) {
		console.log("\n不提供安装（许可不允许）：");
		for (const source of refused) console.log(`   ${source.repo}  license=${source.license}`);
	}
}

await main();
