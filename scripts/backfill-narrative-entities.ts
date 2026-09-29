/**
 * 叙事实体索引回填：对存量书籍整本重建 migration 0032 的实体索引。
 *
 * 实体索引由经纬条目 + 叙事记忆派生，章后结算后会自动重建；本脚本只用于
 * 升级前积累的存量书籍一次性补建，推导逻辑与结算共用
 * packages/novel-plugin/src/engine/narrative-entity/entity-index.ts，不另写一份。
 *
 * 归并原则（宁可漏并，不可错并）：只用经纬条目的规范名与显式别名做精确匹配（含剥括号形态），
 * 不做模糊 / 子串匹配；找不到的称呼只报告，不凭空建实体。
 *
 * 用法：
 *   bun scripts/backfill-narrative-entities.ts --db=<novelfork.db 路径>            # 只统计，不写入
 *   bun scripts/backfill-narrative-entities.ts --db=<路径> --book=<bookId>          # 单本
 *   bun scripts/backfill-narrative-entities.ts --db=<路径> --apply                  # 写入
 *   追加 --verbose 显示未归并称呼样例。
 *
 * 必须显式给出 --db：不默认打开用户真实库，避免误写。
 */

import { createStorageDatabase } from "../packages/core/src/storage/index.js";
import { rebuildNarrativeEntityIndex } from "../packages/novel-plugin/src/engine/narrative-entity/entity-index.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose");
const BOOK_FILTER = args.find((arg) => arg.startsWith("--book="))?.slice("--book=".length);
const DB_PATH = args.find((arg) => arg.startsWith("--db="))?.slice("--db=".length);

if (!DB_PATH) {
  console.error("请用 --db=<novelfork.db 路径> 指定数据库。");
  process.exit(1);
}

const storage = createStorageDatabase({ databasePath: DB_PATH });
console.log(`模式：${APPLY ? "写入（--apply）" : "只统计"}`);
console.log(`数据库：${DB_PATH}\n`);

const books = (BOOK_FILTER
  ? storage.sqlite.prepare<{ id: string }>("SELECT id FROM book WHERE id = ?").all(BOOK_FILTER)
  : storage.sqlite.prepare<{ id: string }>("SELECT id FROM book").all());

let failed = false;
console.log("书籍".padEnd(34), "实体".padStart(5), "参与".padStart(5), "关系".padStart(5), "状态".padStart(5), "归并率".padStart(7));
for (const book of books) {
  const result = rebuildNarrativeEntityIndex(storage, book.id, { dryRun: !APPLY });
  if (!result.ok) {
    console.error(`${book.id}：${result.explanation}`);
    failed = true;
    continue;
  }
  if (result.entities === 0 && result.totalMentions === 0) continue;
  const rate = result.totalMentions > 0 ? `${((result.resolvedMentions / result.totalMentions) * 100).toFixed(1)}%` : "—";
  console.log(
    book.id.slice(0, 32).padEnd(34),
    String(result.entities).padStart(5), String(result.participants).padStart(5),
    String(result.relations).padStart(5), String(result.stateChanges).padStart(5), rate.padStart(7),
  );
  if (VERBOSE && result.unresolvedSamples.length > 0) console.log(`  未归并：${result.unresolvedSamples.join(" / ")}`);
  if (result.duplicateEntryIds.length > 0) console.log(`  同名未收录的经纬条目：${result.duplicateEntryIds.join(", ")}`);
}

storage.close();
console.log(APPLY ? "\n写入完成。" : "\n只统计，未写入任何数据。确认无误后加 --apply。");
if (failed) process.exitCode = 1;
