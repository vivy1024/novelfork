/**
 * 把外部参考仓库的 SKILL.md 装进 NovelFork 内置 skills 市场。
 *
 * 用法：
 *   bun scripts/import-market-skills.ts --report-only      # 只看会装什么
 *   bun scripts/import-market-skills.ts                    # 装 MIT 许可的
 *   bun scripts/import-market-skills.ts --include-unlicensed
 *                                                          # 连未声明许可的一起装（需自行承担风险）
 *
 * 许可纪律（重要）：
 *
 * 标明来源满足的是**署名**义务，不产生**分发权**。没有 LICENSE 文件的仓库，
 * 法律默认是「保留所有权利」，把它的内容打进 NovelFork 分发属侵权，作者可要求
 * 下架或索赔。CC BY-NC-SA 明确禁止商业使用，署名也不够。
 *
 * 所以默认只装 `allowedByDefault: true` 的仓库；其余需要显式 --include-unlicensed，
 * 由调用者对风险负责。每个装入的 skill 都会写入 `_source.json` 记录来源与许可。
 */

import { mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const REFERENCE_ROOT = "reference-skills";
const TARGET_ROOT = join("packages", "novel-plugin", "skills-market");

interface SourceRepo {
	/** reference-skills 下的目录名 */
	readonly dir: string;
	/** 上游仓库地址，写进 _source.json 并在 UI 里展示 */
	readonly repo: string;
	readonly license: string;
	/**
	 * 是否允许默认打包进分发物。
	 * 只有作者明确授予分发权（MIT / Apache / CC BY 等）才为 true。
	 */
	readonly allowedByDefault: boolean;
	/** 相对仓库根的 skill 搜索目录；省略则全仓递归找 SKILL.md */
	readonly skillDirs?: ReadonlyArray<string>;
	/** 跳过的 skill 目录名：环境部署、浏览器控制等与写作无关的 */
	readonly skip?: ReadonlyArray<string>;
}

const SOURCES: ReadonlyArray<SourceRepo> = [
	{
		dir: "worldwonderer_oh-story-claudecode",
		repo: "https://github.com/worldwonderer/oh-story-claudecode",
		license: "MIT",
		allowedByDefault: true,
		skillDirs: ["skills"],
		// browser-cdp / story-setup 是运行环境部署，不是写作方法
		skip: ["browser-cdp", "story-setup"],
	},
	{
		dir: "XINGANLIU_web-novel-writing-skill",
		repo: "https://github.com/XINGANLIU/web-novel-writing-skill",
		license: "MIT",
		allowedByDefault: true,
	},
	{
		dir: "LAY-lgtm_novel-writing-framework",
		repo: "https://github.com/LAY-lgtm/novel-writing-framework",
		license: "MIT",
		allowedByDefault: true,
	},
	{
		dir: "sigpanic_goink-skills",
		repo: "https://github.com/sigpanic/goink-skills",
		license: "CC-BY-SA-4.0",
		// BY-SA 允许分发，但要求以相同许可共享衍生内容。
		allowedByDefault: true,
	},
	{
		dir: "lornshrimp_Lorn.NovelWriteSkills",
		repo: "https://github.com/lornshrimp/Lorn.NovelWriteSkills",
		license: "UNSPECIFIED",
		// 无 LICENSE 文件 = 保留所有权利。量最大（354 份）但默认不打包。
		allowedByDefault: false,
	},
	{
		dir: "mane23-ai_claude-novel-skill",
		repo: "https://github.com/mane23-ai/claude-novel-skill",
		license: "UNSPECIFIED",
		allowedByDefault: false,
	},
	{
		dir: "zy-zmc_tianming-skill",
		repo: "https://github.com/zy-zmc/tianming-skill",
		license: "CC-BY-NC-SA-4.0",
		// NC = 禁止商业使用。NovelFork 商业化时不可带。
		allowedByDefault: false,
	},
];

interface ImportedSkill {
	readonly slug: string;
	readonly name: string;
	readonly description: string;
	readonly repo: string;
	readonly license: string;
	readonly upstreamPath: string;
	readonly referenceCount: number;
}

/**
 * 按 skill 名称推断套路分类。
 *
 * 外部仓库的 frontmatter 没有 `kind`（那是 NovelFork 自定义字段），
 * 若不推断，解析器会把它们全兜底成 `workflow` —— 370 个挤在一格，分类等于没用。
 *
 * 规则放在导入脚本里而不是解析器里：解析器只认显式声明的 kind，
 * 保持「分类由声明决定，不靠内容正则猜」这条纪律；这里是导入期的一次性归类，
 * 归类结果会写进 SKILL.md 的 frontmatter，之后就是显式声明。
 */
const KIND_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // 平台分发：输出各平台版、母稿提纯、投稿组包、签约评估
  [/输出.*版|多平台|母稿|投稿|签约|分发|平台/, "platform"],
  // 包装：标题、简介、封面、书评、作者有话说 —— 作品外围而非正文
  [/设计标题|标题|内容简介|简介|封面|书评|有话说/, "packaging"],
  // 调研：竞对分析、题材定位、深度研究、蒸馏（拆解他人作品）
  [/竞对|分析.*作品|题材定位|深度研究|研究|蒸馏|扫榜/, "research"],
  // 修订审阅：审阅、润色、去 AI 味、优化闭环
  [/审阅|润色|去ai味|去AI味|优化闭环|回炉|重写|humanizer|slop|renhua/i, "revision"],
  // 开篇：黄金三章、章节开头
  [/黄金三章|开篇|章节开头|开头/, "opening"],
  // 节奏：章末钩子、节拍、爽点、章节控制卡
  [/章末钩子|钩子|节奏|节拍|爽点|控制卡/, "pacing"],
  // 人物：人物传记、角色
  [/人物|角色|传记/, "character"],
  // 情节：大纲、伏笔、事件引擎、故事设定、连续性
  [/大纲|伏笔|线索|事件|案件|故事设定|故事面|冷热线|连续性/, "plot"],
  // 文笔：对话冲突、场景单元、正文创作、文风
  [/对话|冲突|场景|正文|文风/, "prose"],
  // 其余归流程：项目初始化、章节创作闭环、素材库
  [/初始化|闭环|素材/, "workflow"],
];

/**
 * 排除项：上游仓库里嵌套了整个第三方仓库（如 `通用-去AI味重写/taste-skill-main/`），
 * 递归扫描会把它们的设计/前端类 skill 一并带进来 —— brandkit、imagegen、
 * image-to-code 这些和网文写作无关，是噪音。
 *
 * 中文去 AI 味的（humanizer / shuorenhua / stop-slop）保留，那是对口内容。
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

/** lornshrimp 按题材分目录；把题材提出来当 tag，作者才能按题材筛。 */
const GENRE_DIRS: ReadonlyArray<string> = [
  "AI科幻",
  "太空科幻",
  "女频爱情",
  "异能志怪",
  "悬疑推理",
  "赛博庞克",
  "都市悬疑",
  "都市职场",
];

function extractGenre(upstreamPath: string, skillName: string): string | null {
  const head = upstreamPath.split("/")[0] ?? "";
  if (GENRE_DIRS.includes(head)) return head;
  for (const genre of GENRE_DIRS) {
    if (skillName.startsWith(`${genre}-`)) return genre;
  }
  return null;
}

/**
 * 给外部 SKILL.md 补上 `kind` 与题材 tag。
 *
 * 只在 frontmatter 缺 kind 时补；已有 kind 的（我们自己的格式）原样保留。
 */
function annotateFrontmatter(
  rawInput: string,
  kind: string,
  genre: string | null,
): string {
  // 上游文件多为 CRLF；正则按 \n 写，先统一换行再处理，否则匹配不到 frontmatter。
  const raw = rawInput.replace(/\r\n/g, "\n");
  const match = /^(\ufeff?)---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) return raw;

  const bom = match[1] ?? "";
  let frontmatter = match[2] ?? "";
  const rest = raw.slice(match[0].length);

  const additions: string[] = [];
  if (!/^kind:/m.test(frontmatter)) additions.push(`kind: ${kind}`);
  if (genre && !/^tags:/m.test(frontmatter)) {
    additions.push(`tags:\n  - ${genre}`);
  } else if (genre && /^tags:/m.test(frontmatter)) {
    // 已有 tags 时追加题材，保持原缩进风格
    frontmatter = frontmatter.replace(/^tags:\s*$/m, `tags:\n  - ${genre}`);
  }

  if (additions.length === 0) return raw;
  return `${bom}---\n${frontmatter}\n${additions.join("\n")}\n---${rest}`;
}

function slugify(repoDir: string, skillDirName: string): string {
	const prefix = repoDir.split("_")[0]?.toLowerCase() ?? "src";
	const base = skillDirName
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5-_]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${prefix}--${base || "skill"}`;
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
		} else if (entry.name.endsWith(".md")) {
			await writeFile(dst, await readFile(src, "utf-8"), "utf-8");
			count += 1;
		}
	}
	return count;
}

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const reportOnly = args.has("--report-only");
	const includeUnlicensed = args.has("--include-unlicensed");

	const selected = SOURCES.filter((s) => s.allowedByDefault || includeUnlicensed);
	const excluded = SOURCES.filter((s) => !s.allowedByDefault && !includeUnlicensed);

	const imported: ImportedSkill[] = [];
	const seen = new Set<string>();
	const kindTally = new Map<string, number>();

	for (const source of selected) {
		const repoRoot = join(REFERENCE_ROOT, source.dir);
		try {
			await stat(repoRoot);
		} catch {
			console.warn(`[skip] 找不到仓库目录：${repoRoot}`);
			continue;
		}

		const searchRoots = source.skillDirs?.map((d) => join(repoRoot, d)) ?? [repoRoot];
		for (const searchRoot of searchRoots) {
			for (const skillFile of await findSkillFiles(searchRoot)) {
				const skillDir = skillFile.slice(0, skillFile.length - "SKILL.md".length - 1);
				const dirName = skillDir.split(sep).pop() ?? "skill";
				if (source.skip?.includes(dirName)) continue;

				const raw = await readFile(skillFile, "utf-8");
				const name = readFrontmatterField(raw, "name");
				const description = readFrontmatterField(raw, "description");
				if (!name || !description) {
					console.warn(`[skip] 缺 name/description：${relative(".", skillFile)}`);
					continue;
				}

				let slug = slugify(source.dir, dirName);
				let dedupe = 2;
				while (seen.has(slug)) slug = `${slugify(source.dir, dirName)}-${dedupe++}`;
				seen.add(slug);

				const upstreamRel = relative(repoRoot, skillFile).split(sep).join("/");
				if (isExcluded(upstreamRel)) continue;
				const kind = inferKind(name, dirName);
				const genre = extractGenre(upstreamRel, name);
				kindTally.set(kind, (kindTally.get(kind) ?? 0) + 1);

				let referenceCount = 0;
				if (!reportOnly) {
					const target = join(TARGET_ROOT, slug);
					await mkdir(target, { recursive: true });
					await writeFile(
						join(target, "SKILL.md"),
						annotateFrontmatter(raw, kind, genre),
						"utf-8",
					);
					referenceCount = await copyDir(join(skillDir, "references"), join(target, "references"));
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
				} else {
					referenceCount = (await findSkillFiles(join(skillDir, "references"))).length;
				}

				imported.push({
					slug,
					name,
					description: description.slice(0, 80),
					repo: source.repo,
					license: source.license,
					upstreamPath: upstreamRel,
					referenceCount,
				});
			}
		}
	}

	if (!reportOnly) {
		await writeFile(
			join(TARGET_ROOT, "index.json"),
			`${JSON.stringify(
				{
					generatedBy: "scripts/import-market-skills.ts",
					sources: selected.map((s) => ({ repo: s.repo, license: s.license })),
					skills: imported.map((s) => ({
						slug: s.slug,
						name: s.name,
						repo: s.repo,
						license: s.license,
						upstreamPath: s.upstreamPath,
					})),
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
	}

	console.log(`${reportOnly ? "[report-only] 会装入" : "已装入"} ${imported.length} 个 skill`);
	const byRepo = new Map<string, number>();
	for (const s of imported) byRepo.set(s.repo, (byRepo.get(s.repo) ?? 0) + 1);
	for (const [repo, count] of byRepo) console.log(`   ${count.toString().padStart(4)} ← ${repo}`);

	console.log("\n分类分布（作者按这个筛选，不该出现一类独大）：");
	for (const [kind, count] of [...kindTally.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`   ${count.toString().padStart(4)}  ${kind}`);
	}

	if (excluded.length > 0) {
		console.log("\n未装入（许可不允许默认分发）：");
		for (const s of excluded) {
			console.log(`   ${s.dir}  license=${s.license}`);
		}
		console.log(
			"\n标明来源满足署名义务，但不产生分发权。要纳入需先取得授权，" +
				"或用 --include-unlicensed 自行承担风险。",
		);
	}
}

await main();
