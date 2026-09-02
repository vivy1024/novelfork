/**
 * 一次性：把 Embedding 配置写入产品库 kv_store，并回填实体向量。
 *
 * 密钥只从环境变量读，不进仓库：
 *   SILICONFLOW_API_KEY=... bun scripts/backfill-entity-embeddings.ts
 *
 * 默认写 ~/.novelfork/novelfork.db。可用 --db= 覆盖。
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase } from "../packages/core/src/storage/db.ts";
import { loadEmbeddingConfig, probeEmbeddingSettings, saveEmbeddingSettings } from "../packages/novel-plugin/src/engine/narrative-memory/embedding-settings.ts";
import { loadEntityVectorsFromStore, refreshBookEntityEmbeddings, similarityFromVectors } from "../packages/novel-plugin/src/engine/narrative-memory/embedding-provider.ts";
import { buildEntityDictionary } from "../packages/novel-plugin/src/engine/narrative-memory/entity-dictionary.ts";
import { backfillHookCausalLinks } from "../packages/novel-plugin/src/engine/narrative-memory/causal-backfill.ts";
import { ensureNarrativeMemorySchema } from "../packages/novel-plugin/src/engine/narrative-memory/storage.ts";
import { buildCooccurrenceFromEvents } from "../packages/novel-plugin/src/engine/narrative-memory/wave/narrative-cooccurrence-source.ts";

const args = process.argv.slice(2);
const DB_PATH = args.find((arg) => arg.startsWith("--db="))?.slice("--db=".length)
  ?? join(homedir(), ".novelfork", "novelfork.db");
const BOOK_FILTER = args.find((arg) => arg.startsWith("--book="))?.slice("--book=".length);

const API_KEY = (process.env.SILICONFLOW_API_KEY ?? process.env.NOVELFORK_EMBEDDING_API_KEY ?? "").trim();
if (!API_KEY) {
  console.error("缺少 SILICONFLOW_API_KEY / NOVELFORK_EMBEDDING_API_KEY");
  process.exit(1);
}

const storage = createStorageDatabase({ databasePath: DB_PATH });
ensureNarrativeMemorySchema(storage);

const settings = await saveEmbeddingSettings({
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "BAAI/bge-m3",
  dim: 1024,
  apiKey: API_KEY,
}, storage);
console.log(`配置已写入 kv_store：model=${settings.model} dim=${settings.dim} masked=${settings.apiKeyMasked}`);

const probe = await probeEmbeddingSettings({ storage });
if (!probe.ok) {
  console.error(`探测失败：${probe.error ?? "unknown"}`);
  storage.close();
  process.exit(1);
}
console.log(`探测成功：model=${probe.model} dim=${probe.dim}`);

const books = storage.sqlite.prepare<{ id: string; name: string }>(`
  SELECT id, name FROM book ORDER BY updated_at DESC
`).all();
const targets = BOOK_FILTER ? books.filter((book) => book.id === BOOK_FILTER) : books;
if (targets.length === 0) {
  console.error(BOOK_FILTER ? `找不到书 ${BOOK_FILTER}` : "产品库没有书");
  storage.close();
  process.exit(1);
}

for (const book of targets) {
  const dictionary = buildEntityDictionary(storage, book.id);
  const embeddable = dictionary.entries.filter((entry) => entry.category !== "foreshadowing");
  if (embeddable.length === 0) continue;
  const result = await refreshBookEntityEmbeddings({ storage, bookId: book.id, dictionary });
  const causal = backfillHookCausalLinks(storage, book.id);
  const config = await loadEmbeddingConfig(storage);
  const vectors = config
    ? loadEntityVectorsFromStore(storage, book.id, config.model, config.dim)
    : new Map<string, readonly number[]>();
  const events = storage.sqlite.prepare<{
    id: string;
    chapterNumber: number;
    subject: string;
    object: string;
  }>(`
    SELECT id, chapter_number AS chapterNumber, subject, object
    FROM narrative_event WHERE book_id = ?
  `).all(book.id);
  const cooccurrence = buildCooccurrenceFromEvents({
    dictionary,
    events,
    ...(vectors.size > 0 ? { similarity: similarityFromVectors(vectors), useNovelGain: true } : {}),
  });
  console.log([
    book.name,
    book.id,
    `entities=${embeddable.length}`,
    `embedded=${result.embedded}`,
    `reused=${result.reused}`,
    result.skipped ? `skipped=${result.skipped}` : null,
    `vectors=${vectors.size}`,
    `semanticGainActive=${cooccurrence.semanticGainActive}`,
    `causalLinked=${causal.linked}/${causal.scanned}`,
  ].filter(Boolean).join(" | "));
}

const vectorTotal = storage.sqlite.prepare<{ count: number }>(
  `SELECT COUNT(*) AS count FROM narrative_context_vector`,
).get()?.count ?? 0;
const causedByCol = storage.sqlite.prepare<{ name: string }>(`PRAGMA table_info(narrative_event)`).all().some((row) => row.name === "caused_by_json");
console.log(`完成：vectors=${vectorTotal} caused_by_json=${causedByCol}`);
storage.close();
