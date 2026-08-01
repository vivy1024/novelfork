/**
 * 将唯一的内置 `skills/` 根目录编译为 TypeScript 快照，以便内容随 EXE 分发。
 *
 * 开发态 loader 每次从磁盘读取；编译态则回落到此文件的
 * `BUNDLED_WRITING_SKILLS`。不要手改生成文件。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PLUGIN_ROOT = join("packages", "novel-plugin");
const SKILLS_ROOT = join(PLUGIN_ROOT, "skills");
const OUT_DIR = join(PLUGIN_ROOT, "src", "engine", "writing-skills");
const OUT_FILE = join(OUT_DIR, "bundled-skills.generated.ts");

interface BundledEntry {
  readonly slug: string;
  readonly content: string;
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

async function collectBuiltinSkills(): Promise<ReadonlyArray<BundledEntry>> {
  const skills: BundledEntry[] = [];
  for (const slug of await readDirSafe(SKILLS_ROOT)) {
    const skillDir = join(SKILLS_ROOT, slug);
    const content = await readFileSafe(join(skillDir, "SKILL.md"));
    if (!content) continue;
    skills.push({
      slug,
      content: content.replace(/\r\n/g, "\n"),
      provenance: parseProvenance(await readFileSafe(join(skillDir, "_source.json"))),
    });
  }
  return skills;
}

async function main(): Promise<void> {
  const skills = await collectBuiltinSkills();
  const header = `/**
 * 自动生成，请勿手改。
 *
 * 由 scripts/generate-skills-bundle.ts 从 packages/novel-plugin/skills/ 生成。
 * 此快照是 EXE 中唯一的 builtin fallback；开发态仍以该目录中的 SKILL.md 为准。
 */

export interface BundledWritingSkill {
  readonly slug: string;
  readonly content: string;
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
