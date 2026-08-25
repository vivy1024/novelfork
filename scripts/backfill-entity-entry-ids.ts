/**
 * 存量数据回填脚本——把已有 narrative_event / narrative_fact 的 subject/object
 * 按实体字典匹配回填 entryId。
 *
 * 用法: bun scripts/backfill-entity-entry-ids.ts <bookId>
 */

import { getStorageDatabase } from "../packages/core/src/index.js";
import {
	buildEntityDictionary,
	resolveEntity,
	type EntityDictionary,
} from "../packages/novel-plugin/src/engine/narrative-memory/entity-dictionary.js";

const bookId = process.argv[2];
if (!bookId?.trim()) {
	console.error("用法: bun scripts/backfill-entity-entry-ids.ts <bookId>");
	process.exit(1);
}

const storage = getStorageDatabase();
const dictionary: EntityDictionary = buildEntityDictionary(storage, bookId);

if (dictionary.entries.length === 0) {
	console.log("实体字典为空（无经纬条目），无需回填。");
	process.exit(0);
}

console.log(`字典加载完成：${dictionary.entries.length} 个实体。\n`);

// ── 回填 narrative_event ──────────────────────────────────
const events = storage.sqlite.prepare(
	`SELECT id, subject, object, subject_entry_id, object_entry_id FROM narrative_event WHERE book_id = ?`,
).all(bookId) as Array<{ id: string; subject: string; object: string; subject_entry_id: string | null; object_entry_id: string | null }>;

let eventScanned = 0;
let eventSubjectBackfilled = 0;
let eventObjectBackfilled = 0;

const updateEvent = storage.sqlite.prepare(
	`UPDATE narrative_event SET subject_entry_id = ?, object_entry_id = ? WHERE id = ?`,
);

for (const row of events) {
	eventScanned++;
	const updates: { subject?: string; object?: string } = {};
	if (!row.subject_entry_id) {
		const hit = resolveEntity(dictionary, row.subject);
		if (hit) { updates.subject = hit.entry.entryId; eventSubjectBackfilled++; }
	}
	if (!row.object_entry_id) {
		const hit = resolveEntity(dictionary, row.object);
		if (hit) { updates.object = hit.entry.entryId; eventObjectBackfilled++; }
	}
	if (updates.subject || updates.object) {
		updateEvent.run(updates.subject ?? row.subject_entry_id, updates.object ?? row.object_entry_id, row.id);
	}
}

// ── 回填 narrative_fact ───────────────────────────────────
const facts = storage.sqlite.prepare(
	`SELECT id, subject, subject_entry_id FROM narrative_fact WHERE book_id = ?`,
).all(bookId) as Array<{ id: string; subject: string; subject_entry_id: string | null }>;

let factScanned = 0;
let factSubjectBackfilled = 0;

const updateFact = storage.sqlite.prepare(
	`UPDATE narrative_fact SET subject_entry_id = ? WHERE id = ?`,
);

for (const row of facts) {
	factScanned++;
	if (!row.subject_entry_id) {
		const hit = resolveEntity(dictionary, row.subject);
		if (hit) {
			updateFact.run(hit.entry.entryId, row.id);
			factSubjectBackfilled++;
		}
	}
}

console.log(`narrative_event: 扫描 ${eventScanned} 条，回填 subject ${eventSubjectBackfilled} / object ${eventObjectBackfilled}`);
console.log(`narrative_fact:  扫描 ${factScanned} 条，回填 subject ${factSubjectBackfilled}`);
console.log("\n回填完成。");
