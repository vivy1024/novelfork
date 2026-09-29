/**
 * 由 packages/core/src/storage/migrations/*.sql 生成 embedded-migrations.ts（编译产物唯一的迁移来源）。
 *
 * 为什么要生成：此前内嵌副本靠手工同步，去掉了注释、个别内容也有出入，而迁移校验和包含注释。
 * 结果是在开发环境（读迁移目录）迁移过的库，用 EXE（读内嵌副本）打开会报「迁移已被修改」，反之亦然。
 *
 * 生成规则：
 * - sql 与迁移文件逐字一致（仅统一为 LF），一致性测试会比对内容，不再允许走样；
 * - legacyHashes：从 git 历史收集该迁移在各版内嵌副本与各版文件中出现过的写法，
 *   计算其校验和。已按这些旧写法迁移过的库照常被认作「已应用」，不会被拒绝启动。
 *
 * 用法：bun scripts/generate-embedded-migrations.ts（需在 git 仓库内运行；新增迁移后执行一次）。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "packages", "core", "src", "storage", "migrations");
const OUTPUT = join(ROOT, "packages", "core", "src", "storage", "embedded-migrations.ts");
const OUTPUT_REPO_PATH = "packages/core/src/storage/embedded-migrations.ts";
const MIGRATIONS_REPO_DIR = "packages/core/src/storage/migrations";

const normalize = (sql: string) => sql.replace(/\r\n?/gu, "\n");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** 与运行器 equivalentSqlHashes 同口径：LF 归一、原样、CRLF 三种写法。 */
function equivalentHashes(sql: string): string[] {
  const normalized = normalize(sql);
  return [sha(normalized), sha(sql), sha(normalized.replace(/\n/gu, "\r\n"))];
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

const files = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d+.*\.sql$/u.test(name)).sort((a, b) => a.localeCompare(b));
const current = new Map(files.map((name) => [name, normalize(readFileSync(join(MIGRATIONS_DIR, name), "utf8"))] as const));
const legacy = new Map<string, Set<string>>(files.map((name) => [name, new Set<string>()]));

// ① 各版迁移文件
for (const name of files) {
  const commits = git(["log", "--format=%H", "--", `${MIGRATIONS_REPO_DIR}/${name}`]).split("\n").filter(Boolean);
  for (const commit of commits) {
    let sql: string;
    try {
      sql = git(["show", `${commit}:${MIGRATIONS_REPO_DIR}/${name}`]);
    } catch {
      continue; // 该提交里文件已被删除
    }
    for (const hash of equivalentHashes(sql)) legacy.get(name)!.add(hash);
  }
}

// ② 各版手工内嵌副本（逐版导入取 sql）
const scratch = mkdtempSync(join(tmpdir(), "nf-embedded-history-"));
try {
  const commits = git(["log", "--format=%H", "--", OUTPUT_REPO_PATH]).split("\n").filter(Boolean);
  for (const [index, commit] of commits.entries()) {
    let source: string;
    try {
      source = git(["show", `${commit}:${OUTPUT_REPO_PATH}`]);
    } catch {
      continue;
    }
    const path = join(scratch, `embedded-${index}.ts`);
    writeFileSync(path, source, "utf8");
    const module = await import(pathToFileURL(path).href) as { embeddedMigrations?: ReadonlyArray<{ name: string; sql: string }> };
    for (const migration of module.embeddedMigrations ?? []) {
      const bucket = legacy.get(migration.name);
      if (!bucket) continue;
      for (const hash of equivalentHashes(migration.sql)) bucket.add(hash);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ③ 工作区里尚未提交的那一版内嵌副本（覆盖前读取）
try {
  const module = await import(`${pathToFileURL(OUTPUT).href}?before=${Date.now()}`) as { embeddedMigrations?: ReadonlyArray<{ name: string; sql: string }> };
  for (const migration of module.embeddedMigrations ?? []) {
    const bucket = legacy.get(migration.name);
    if (!bucket) continue;
    for (const hash of equivalentHashes(migration.sql)) bucket.add(hash);
  }
} catch {
  // 首次生成或旧文件无法导入时跳过
}

// 当前写法的校验和由运行器现算，不重复登记
for (const [name, sql] of current) {
  const bucket = legacy.get(name)!;
  for (const hash of equivalentHashes(sql)) bucket.delete(hash);
}

const escapeTemplate = (sql: string) => sql.replace(/\\/gu, "\\\\").replace(/`/gu, "\\`").replace(/\$\{/gu, "\\${");
const entries = files.map((name) => {
  const hashes = [...legacy.get(name)!].sort();
  return `  {\n    name: ${JSON.stringify(name)},\n    legacyHashes: ${JSON.stringify(hashes)},\n    sql: \`${escapeTemplate(current.get(name)!)}\`,\n  },`;
});

const output = `// 自动生成，请勿手改：bun scripts/generate-embedded-migrations.ts
// 编译产物没有 migrations 目录时，运行器改用这里的 SQL；内容与迁移文件逐字一致（LF）。
// legacyHashes 是历史上出现过的旧写法（手工内嵌副本、迁移文件旧版本）的校验和，
// 按旧写法迁移过的库照常视为已应用。

export interface EmbeddedMigration {
  readonly name: string;
  readonly sql: string;
  readonly legacyHashes: readonly string[];
}

export const embeddedMigrations: ReadonlyArray<EmbeddedMigration> = [
${entries.join("\n")}
];
`;

writeFileSync(OUTPUT, output, "utf8");
const legacyCount = [...legacy.values()].reduce((sum, set) => sum + set.size, 0);
console.log(`已生成 ${OUTPUT_REPO_PATH}：${files.length} 个迁移，登记旧写法校验和 ${legacyCount} 个。`);
