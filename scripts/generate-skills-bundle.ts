/**
 * 将唯一的内置技能根目录 `packages/novel-plugin/builtin-skills/` 编译为 TypeScript 快照，
 * 以便内容随 EXE 分发。
 *
 * 开发态 loader 每次从磁盘读取；编译态则回落到此文件的
 * `BUNDLED_WRITING_SKILLS`。不要手改生成文件。
 *
 * 内置只放 NovelFork 自研、MIT 许可的技能：每个目录必须带
 * `_source.json`（origin=novelfork、license=MIT），否则生成直接失败。
 * 第三方技能不随产品分发，由作者自行安装到作者技能目录。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PLUGIN_ROOT = join("packages", "novel-plugin");
const SKILLS_ROOT = join(PLUGIN_ROOT, "builtin-skills");
const OUT_DIR = join(PLUGIN_ROOT, "src", "engine", "writing-skills");
const OUT_FILE = join(OUT_DIR, "bundled-skills.generated.ts");

interface BundledEntry {
  readonly slug: string;
  readonly content: string;
  /** SKILL.md 之外的附件（references/ 等），相对路径 → 文本。空对象表示无附件。 */
  readonly files: Readonly<Record<string, string>>;
  readonly provenance: { repo: string; license: string; upstreamPath?: string } | null;
}

function isSafeSkillSlug(value: string): boolean {
  return Boolean(value)
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes(":");
}

async function readDirSafe(dir: string): Promise<ReadonlyArray<string>> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isSafeSkillSlug(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  } catch {
    return [];
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function parseProvenance(raw: string | null): BundledEntry["provenance"] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.repo !== "string" || !parsed.repo.trim()) return null;
    return {
      repo: parsed.repo.trim(),
      license: typeof parsed.license === "string" && parsed.license.trim()
        ? parsed.license.trim()
        : "UNSPECIFIED",
      ...(typeof parsed.upstreamPath === "string" && parsed.upstreamPath.trim()
        ? { upstreamPath: parsed.upstreamPath.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}

async function collectSkillFiles(dir: string, base: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const relative = `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(files, await collectSkillFiles(full, relative));
    } else if (entry.isFile()) {
      const raw = await readFileSafe(full);
      if (raw !== null) files[relative] = raw.replace(/\r\n/g, "\n");
    }
  }
  return files;
}

/** 内置技能必须是 NovelFork 自研、MIT 许可；不满足就拒绝生成，而不是静默跳过。 */
function assertOwnSkill(slug: string, raw: string | null): void {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.origin !== "novelfork" || parsed.license !== "MIT") {
    throw new Error(
      `内置技能「${slug}」缺少 _source.json 或不是 NovelFork 自研 MIT 技能（需要 origin=novelfork、license=MIT）。`
      + "第三方技能不能放进 builtin-skills/，请改为作者自行安装到作者技能目录。",
    );
  }
}

async function collectBuiltinSkills(): Promise<ReadonlyArray<BundledEntry>> {
  const skills: BundledEntry[] = [];
  for (const slug of await readDirSafe(SKILLS_ROOT)) {
    const skillDir = join(SKILLS_ROOT, slug);
    const content = await readFileSafe(join(skillDir, "SKILL.md"));
    if (!content) throw new Error(`内置技能目录「${slug}」缺少 SKILL.md。`);
    const sourceRaw = await readFileSafe(join(skillDir, "_source.json"));
    assertOwnSkill(slug, sourceRaw);
    // _source.json 是溯源元数据（provenance 已入类型），不随附件分发。
    const files = await collectSkillFiles(skillDir, "");
    delete files["/_source.json"];
    const normalizedFiles: Record<string, string> = {};
    for (const [path, text] of Object.entries(files)) {
      normalizedFiles[path.replace(/^\/+/, "")] = text;
    }
    skills.push({
      slug,
      content: content.replace(/\r\n/g, "\n"),
      files: normalizedFiles,
      // 自研技能的 _source.json 不带 repo，provenance 为 null，界面据此显示「NovelFork 原生」。
      provenance: parseProvenance(sourceRaw),
    });
  }
  return skills;
}

async function main(): Promise<void> {
  const skills = await collectBuiltinSkills();
  const header = `/**
 * 自动生成，请勿手改。
 *
 * 由 scripts/generate-skills-bundle.ts 从 packages/novel-plugin/builtin-skills/ 生成。
 * 此快照是 EXE 中唯一的 builtin fallback；开发态仍以该目录中的 SKILL.md 为准。
 */

export interface BundledWritingSkill {
  readonly slug: string;
  readonly content: string;
  /** SKILL.md 之外的附件（references/ 等），相对路径 → 文本。 */
  readonly files: Readonly<Record<string, string>>;
  readonly provenance: {
    readonly repo: string;
    readonly license: string;
    readonly upstreamPath?: string;
  } | null;
}

`;
  const body = `export const BUNDLED_WRITING_SKILLS: ReadonlyArray<BundledWritingSkill> = ${JSON.stringify(skills, null, 1)};\n`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, header + body, "utf-8");

  const bytes = Buffer.byteLength(header + body, "utf-8");
  console.log(`✓ ${OUT_FILE}`);
  console.log(`  内置 ${skills.length} 份 SKILL.md`);
  console.log(`  体积 ${(bytes / 1048576).toFixed(2)} MB`);
}

await main();
