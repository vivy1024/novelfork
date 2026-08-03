/**
 * 将 `packages/core/genres/` 下的题材 profile 编译为 TypeScript 快照，使其随 EXE 分发。
 *
 * 开发态 `readGenreProfile` 仍优先读磁盘；编译态磁盘上没有源码树，
 * 只能回落到本脚本生成的 `BUNDLED_GENRE_PROFILES`。不要手改生成文件。
 *
 * 生成时强校验：必须包含 `other`（唯一 fallback），每份都必须能通过
 * `parseGenreProfile`，且 frontmatter 的 id 必须与文件名一致 —— 坏资源
 * 绝不允许被打进 EXE。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseGenreProfile } from "../packages/core/src/models/genre-profile.js";

const CORE_ROOT = join("packages", "core");
const GENRES_ROOT = join(CORE_ROOT, "genres");
const OUT_DIR = join(CORE_ROOT, "src", "models");
const OUT_FILE = join(OUT_DIR, "bundled-genre-profiles.generated.ts");

/** 唯一 fallback：`readGenreProfile` 在所有来源都命不中时依赖它。 */
const FALLBACK_GENRE_ID = "other";

interface BundledEntry {
  readonly id: string;
  readonly content: string;
}

function isSafeGenreId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

async function collectGenreProfiles(): Promise<ReadonlyArray<BundledEntry>> {
  const entries = await readdir(GENRES_ROOT, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const profiles: BundledEntry[] = [];
  for (const file of files) {
    const id = file.replace(/\.md$/u, "");
    if (!isSafeGenreId(id)) {
      throw new Error(`题材文件名不是安全的 genre id：${file}`);
    }

    const content = (await readFile(join(GENRES_ROOT, file), "utf-8")).replace(/\r\n/g, "\n");

    // 解析失败或 id 漂移的资源必须在打包前暴露，而不是等运行时写章才炸。
    const parsed = parseGenreProfile(content);
    if (parsed.profile.id !== id) {
      throw new Error(`题材 ${file} 的 frontmatter id 是「${parsed.profile.id}」，与文件名不一致。`);
    }

    profiles.push({ id, content });
  }

  if (!profiles.some((profile) => profile.id === FALLBACK_GENRE_ID)) {
    throw new Error(`题材快照缺少 fallback「${FALLBACK_GENRE_ID}.md」，编译态将无法兜底未知题材。`);
  }

  return profiles;
}

async function main(): Promise<void> {
  const profiles = await collectGenreProfiles();
  const header = `/**
 * 自动生成，请勿手改。
 *
 * 由 scripts/generate-genre-profiles-bundle.ts 从 packages/core/genres/ 生成。
 * 此快照是 EXE 中唯一的 builtin 题材来源；开发态仍以该目录中的 .md 为准。
 */

export interface BundledGenreProfile {
  readonly id: string;
  readonly content: string;
}

`;
  const body = `export const BUNDLED_GENRE_PROFILES: ReadonlyArray<BundledGenreProfile> = ${JSON.stringify(profiles, null, 1)};\n`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, header + body, "utf-8");

  const bytes = Buffer.byteLength(header + body, "utf-8");
  console.log(`✓ ${OUT_FILE}`);
  console.log(`  内置 ${profiles.length} 份题材 profile（含 fallback ${FALLBACK_GENRE_ID}）`);
  console.log(`  体积 ${(bytes / 1024).toFixed(1)} KB`);
}

await main();
