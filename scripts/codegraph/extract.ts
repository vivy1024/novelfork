/**
 * CodeGraph 符号提取器（纯正则，零依赖）
 *
 * 扫描 packages 源码，提取每个文件的导出符号 + import 依赖边 + 一句话职责。
 * 给 AI 当代码导航索引用，避免反复 grep 抓取。
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export type SymbolKind = "function" | "class" | "interface" | "type" | "const" | "reexport";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
  readonly signature: string;
  readonly doc: string;
}

export interface FileEntry {
  /** 相对仓库根的 posix 路径 */
  readonly path: string;
  readonly hash: string;
  readonly pkg: string;
  /** 解析后的依赖目标（相对根路径，仅项目内文件） */
  readonly imports: string[];
  readonly symbols: CodeSymbol[];
}

const PACKAGES = ["core", "novel-plugin", "studio", "cli"];

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

/** djb2 全文 hash（增量更新用） */
function quickHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${h >>> 0}:${s.length}`;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
}

/** 列出某包下所有源文件（绝对路径） */
export function listSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const pkg of PACKAGES) {
    walk(path.join(repoRoot, "packages", pkg, "src"), files);
  }
  return files;
}

/** 取符号定义行上方的注释（block 首行或单行 //）作为一句话职责 */
function docAbove(lines: string[], lineIdx: number): string {
  for (let i = lineIdx - 1; i >= 0 && i >= lineIdx - 3; i--) {
    const t = (lines[i] ?? "").trim();
    if (!t) continue;
    const m = t.match(/^\/\*\*?\s*(.+?)(\*\/)?$/) || t.match(/^\*\s*(.+?)$/) || t.match(/^\/\/\s*(.+)$/);
    if (m && m[1]) {
      const doc = m[1].replace(/\*\/\s*$/, "").trim();
      if (doc && !doc.startsWith("@")) return doc.slice(0, 120);
    }
    if (!t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*")) break;
  }
  return "";
}

// SPLICE: parseFile + extract below

const SYMBOL_PATTERNS: Array<{ re: RegExp; kind: SymbolKind }> = [
  { re: /^export\s+(?:async\s+)?function\s+(\w+)/, kind: "function" },
  { re: /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class" },
  { re: /^export\s+interface\s+(\w+)/, kind: "interface" },
  { re: /^export\s+type\s+(\w+)/, kind: "type" },
  { re: /^export\s+(?:const|let|var)\s+(\w+)/, kind: "const" },
  { re: /^export\s+enum\s+(\w+)/, kind: "type" },
];

/** 解析 import 的相对路径目标为仓库内 .ts 文件（绝对路径），失败返回 null */
function resolveImport(fromAbs: string, spec: string, repoRoot: string): string | null {
  if (!spec.startsWith(".")) return null; // 仅项目内相对导入
  const base = path.resolve(path.dirname(fromAbs), spec.replace(/\.js$/, ""));
  for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch { /* try next */ }
  }
  return null;
}

function pkgOf(absPath: string, repoRoot: string): string {
  const relPath = posix(path.relative(repoRoot, absPath));
  const m = relPath.match(/^packages\/([^/]+)\//);
  return m?.[1] ?? "unknown";
}

/** 解析单个文件 → FileEntry */
export function parseFile(absPath: string, repoRoot: string): FileEntry {
  const raw = readFileSync(absPath, "utf-8");
  const lines = raw.split("\n");
  const symbols: CodeSymbol[] = [];
  const importTargets = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // import 边
    const imp = trimmed.match(/^(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/);
    if (imp?.[1]) {
      const target = resolveImport(absPath, imp[1], repoRoot);
      if (target) importTargets.add(posix(path.relative(repoRoot, target)));
    }

    // re-export: export * from / export { ... } from
    if (/^export\s+\*\s+from/.test(trimmed) || /^export\s+\{[^}]*\}\s+from/.test(trimmed)) {
      const names = trimmed.match(/\{([^}]*)\}/)?.[1];
      if (names) {
        for (const n of names.split(",").map((s: string) => s.trim().split(/\s+as\s+/)[0]?.trim()).filter(Boolean)) {
          if (n && /^\w+$/.test(n)) symbols.push({ name: n, kind: "reexport", line: i + 1, signature: `export { ${n} }`, doc: "" });
        }
      }
      continue;
    }

    // 导出符号
    for (const { re, kind } of SYMBOL_PATTERNS) {
      const m = trimmed.match(re);
      if (m?.[1]) {
        symbols.push({
          name: m[1],
          kind,
          line: i + 1,
          signature: trimmed.replace(/\s*\{?\s*$/, "").slice(0, 160),
          doc: docAbove(lines, i),
        });
        break;
      }
    }
  }

  return {
    path: posix(path.relative(repoRoot, absPath)),
    hash: quickHash(raw),
    pkg: pkgOf(absPath, repoRoot),
    imports: [...importTargets].sort(),
    symbols,
  };
}

/** 全量提取所有源文件 */
export function extractAll(repoRoot: string): FileEntry[] {
  return listSourceFiles(repoRoot)
    .map((abs) => parseFile(abs, repoRoot))
    .sort((a, b) => a.path.localeCompare(b.path));
}

