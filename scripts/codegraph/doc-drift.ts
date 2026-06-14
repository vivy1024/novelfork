/**
 * 文档漂移检查（codegraph 驱动）
 *
 * 扫描 docs 下所有 markdown 里反引号引用的「项目文件路径」，对照实际文件系统 +
 * codegraph.json，报出指向不存在文件的过时引用（doc drift）。
 *
 * 捕获：文档提到 `packages/.../foo.ts` 但文件已删/改名（如已删的 chapter-analyzer.ts）。
 * 用法：bun run docs:drift
 */
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import path from "path";

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, "docs");

interface Drift {
  readonly doc: string;
  readonly ref: string;
  readonly line: number;
}

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

function walkMd(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "codegraph") continue; // 跳过生成物
      walkMd(full, out);
    } else if (name.endsWith(".md")) {
      out.push(full);
    }
  }
}

/** 从一行里提取反引号包裹的、形如项目源码路径的引用 */
function extractFileRefs(line: string): string[] {
  const refs: string[] = [];
  // 反引号内、以 packages/ 或 scripts/ 开头、到结尾的源码路径（避免 glob/命令前缀/相对路径）
  const re = /`((?:packages|scripts)\/[^\s`*]+\.(?:ts|tsx|js|sql))`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const ref = m[1]!.trim();
    if (ref.includes("*")) continue; // glob 跳过
    refs.push(ref);
  }
  return refs;
}

/** 从 session-tool-registry.ts 读取 DEPRECATED_V1_TOOLS 工具名清单 */
function loadDeprecatedTools(): string[] {
  const reg = path.join(repoRoot, "packages/studio/src/api/lib/session-tool-registry.ts");
  if (!existsSync(reg)) return [];
  const src = readFileSync(reg, "utf-8");
  const block = src.match(/DEPRECATED_V1_TOOLS[^=]*=\s*(?:new Set\()?\[([\s\S]*?)\]/);
  if (!block?.[1]) return [];
  const names = [...block[1].matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]!);
  return [...new Set(names)];
}

/** 文档中合法引用废弃工具的豁免目录（changelog/归档/迁移记录） */
function isExemptDoc(docRel: string): boolean {
  return /99-历史归档|archived|迁移|变更记录|parity-gap/i.test(docRel);
}

interface ToolDrift {
  readonly doc: string;
  readonly tool: string;
  readonly line: number;
}

function main(): void {
  const docs: string[] = [];
  walkMd(docsRoot, docs);

  const drifts: Drift[] = [];
  const deprecatedTools = loadDeprecatedTools();
  const toolDrifts: ToolDrift[] = [];

  for (const docAbs of docs) {
    const lines = readFileSync(docAbs, "utf-8").split("\n");
    const docRel = posix(path.relative(repoRoot, docAbs));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const ref of extractFileRefs(line)) {
        const cleaned = ref.split(/[:#]/)[0]!;
        if (!existsSync(path.join(repoRoot, cleaned))) {
          drifts.push({ doc: docRel, ref: cleaned, line: i + 1 });
        }
      }
      // 废弃工具名检测（豁免 changelog/归档/迁移文档）
      if (!isExemptDoc(docRel)) {
        // 同行含废弃标记 = 合法解释（如架构文档讲 v1 vs v2），跳过
        const explainsDeprecation = /废弃|已删|deprecated|DEPRECATED|旧管线|旧工具|v1\b|迁移前|曾经|此前/.test(line);
        if (!explainsDeprecation) {
          for (const tool of deprecatedTools) {
            const re = new RegExp(`(?<![\\w.])${tool.replace(".", "\\.")}(?![\\w])`);
            if (re.test(line)) toolDrifts.push({ doc: docRel, tool, line: i + 1 });
          }
        }
      }
    }
  }

  let failed = false;
  if (drifts.length > 0) {
    failed = true;
    console.log(`[docs:drift] 发现 ${drifts.length} 处指向不存在文件的引用：`);
    for (const d of drifts) console.log(`  ${d.doc}:${d.line} → ${d.ref}`);
  }
  if (toolDrifts.length > 0) {
    failed = true;
    console.log(`\n[docs:drift] 发现 ${toolDrifts.length} 处引用已废弃工具（DEPRECATED_V1_TOOLS）：`);
    for (const d of toolDrifts) console.log(`  ${d.doc}:${d.line} → ${d.tool}`);
  }
  if (!failed) {
    console.log("[docs:drift] ✓ 无过时文件引用、无废弃工具引用");
    return;
  }
  process.exitCode = 1;
}

main();
