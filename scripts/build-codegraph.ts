/**
 * CodeGraph 构建入口（bun run codegraph）
 *
 * 产出：
 *  - docs/codegraph/codegraph.json  母库（全量符号 + 依赖边 + 排序，机器读/增量）
 *  - docs/codegraph/CODEMAP.md      给 AI 的紧凑导航图（按包分组，高分符号 + 签名 + 职责）
 *
 * 消费：AI 会话开始读 CODEMAP.md 当全局地图 → 看图精确定位 → 按需 Read 全文。
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { extractAll, type FileEntry } from "./codegraph/extract.js";
import { pageRank, type RankedFile } from "./codegraph/rank.js";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "docs", "codegraph");

interface CodeGraph {
  readonly version: string;
  readonly generatedAt: string;
  readonly stats: { files: number; symbols: number; edges: number };
  readonly files: FileEntry[];
  readonly ranks: Record<string, RankedFile>;
}

function build(): CodeGraph {
  const files = extractAll(repoRoot);
  const ranks = pageRank(files);
  const symbolCount = files.reduce((s, f) => s + f.symbols.length, 0);
  const edgeCount = files.reduce((s, f) => s + f.imports.length, 0);
  return {
    version: "1",
    generatedAt: new Date().toISOString(),
    stats: { files: files.length, symbols: symbolCount, edges: edgeCount },
    files,
    ranks: Object.fromEntries(ranks),
  };
}

const KIND_TAG: Record<string, string> = {
  class: "class", function: "fn", interface: "interface", type: "type", const: "const", reexport: "re-export",
};

/**
 * 渲染给 AI 的紧凑导航图：每文件一行（路径 + 导出符号名 + ref），按包分组、按 rank 降序。
 * 完整签名/职责/行号/依赖边留在 codegraph.json，AI 看图定位后按需 Read 或查 json。
 */
function renderMarkdown(graph: CodeGraph): string {
  const out: string[] = [];
  out.push("# CODEMAP — NovelFork 代码导航索引");
  out.push("");
  out.push("> 由 `bun run codegraph` 自动生成，请勿手改。");
  out.push("> **AI 用法**：先读本图定位「符号在哪个文件」，再 Read 该文件看细节；完整签名/依赖边查 `codegraph.json`。");
  out.push(`> 生成：${graph.generatedAt}　|　${graph.stats.files} 文件 / ${graph.stats.symbols} 符号 / ${graph.stats.edges} 依赖边`);
  out.push("");

  // 全局热点 Top 25（跨包，按 rank）——AI 快速抓住核心
  const hot = Object.values(graph.ranks)
    .filter((r) => r.refCount > 0)
    .sort((a, b) => b.rank - a.rank || b.refCount - a.refCount)
    .slice(0, 25);
  out.push("## 🔥 核心热点文件（被引用最多，优先理解）");
  out.push("");
  for (const r of hot) out.push(`- \`${r.path}\` [ref:${r.refCount}]`);
  out.push("");

  const byPkg = new Map<string, FileEntry[]>();
  for (const f of graph.files) {
    if (!byPkg.has(f.pkg)) byPkg.set(f.pkg, []);
    byPkg.get(f.pkg)!.push(f);
  }

  const pkgOrder = ["core", "novel-plugin", "studio", "cli"];
  for (const pkg of [...byPkg.keys()].sort((a, b) => (pkgOrder.indexOf(a) + 1 || 99) - (pkgOrder.indexOf(b) + 1 || 99))) {
    const files = byPkg.get(pkg)!.filter((f) => f.symbols.length > 0);
    const ranked = files.sort(
      (a, b) => (graph.ranks[b.path]?.rank ?? 0) - (graph.ranks[a.path]?.rank ?? 0) || a.path.localeCompare(b.path),
    );
    out.push(`## ${pkg}　(${files.length} 个有导出的文件)`);
    out.push("");
    for (const f of ranked) {
      const ref = graph.ranks[f.path]?.refCount ?? 0;
      const refTag = ref > 0 ? ` [ref:${ref}]` : "";
      // 紧凑：每符号 name(kind首字母)；class/fn 标完整 kind，type/const 标缩写
      const syms = f.symbols.map((s) => `${s.name}·${KIND_TAG[s.kind] ?? s.kind}`).join(", ");
      out.push(`- \`${f.path}\`${refTag} — ${syms}`);
    }
    out.push("");
  }
  return out.join("\n");
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const graph = build();
  writeFileSync(path.join(outDir, "codegraph.json"), JSON.stringify(graph, null, 2), "utf-8");
  writeFileSync(path.join(outDir, "CODEMAP.md"), renderMarkdown(graph), "utf-8");
  console.log(`[codegraph] ${graph.stats.files} files, ${graph.stats.symbols} symbols, ${graph.stats.edges} edges`);
  console.log(`[codegraph] wrote docs/codegraph/codegraph.json + CODEMAP.md`);

  // Top 10 热点文件（按 rank）
  const top = Object.values(graph.ranks).sort((a, b) => b.rank - a.rank).slice(0, 10);
  console.log("[codegraph] Top 10 热点文件:");
  for (const r of top) console.log(`  ref:${String(r.refCount).padStart(3)}  ${r.path}`);
}

main();

