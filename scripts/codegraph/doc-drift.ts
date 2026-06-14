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

function main(): void {
  const docs: string[] = [];
  walkMd(docsRoot, docs);

  const drifts: Drift[] = [];
  for (const docAbs of docs) {
    const lines = readFileSync(docAbs, "utf-8").split("\n");
    const docRel = posix(path.relative(repoRoot, docAbs));
    for (let i = 0; i < lines.length; i++) {
      for (const ref of extractFileRefs(lines[i] ?? "")) {
        // 归一：去掉可能的行号后缀 :NN 或 #anchor
        const cleaned = ref.split(/[:#]/)[0]!;
        if (!existsSync(path.join(repoRoot, cleaned))) {
          drifts.push({ doc: docRel, ref: cleaned, line: i + 1 });
        }
      }
    }
  }

  if (drifts.length === 0) {
    console.log("[docs:drift] ✓ 无过时文件引用");
    return;
  }
  console.log(`[docs:drift] 发现 ${drifts.length} 处指向不存在文件的引用：`);
  for (const d of drifts) {
    console.log(`  ${d.doc}:${d.line} → ${d.ref}`);
  }
  process.exitCode = 1;
}

main();
