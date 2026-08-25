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
import {
	deleteCharacterKernel,
	getCharacterKernel,
	listCharacterKernels,
	upsertCharacterKernel,
} from "../packages/novel-plugin/src/engine/narrative-memory/storage.js";

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

// ── 迁移 character_kernel 孤儿记录（装饰标题 → canonical 名）──────────────
// kernel 归一化上线后新写入用 canonical 名；旧记录以装饰标题为 character_id，
// getCharacterKernel(canonical) 永远读不到它们。这里按字典重命名；
// 目标名已存在内核时不自动合并（字段语义不同不可盲合），报告后由作者决定。
const kernels = listCharacterKernels(storage, { bookId, includeArchived: true });
let kernelScanned = 0;
let kernelRenamed = 0;
let kernelConflictSkipped = 0;

for (const kernel of kernels) {
	kernelScanned++;
	const hit = resolveEntity(dictionary, kernel.characterId);
	if (!hit || hit.entry.canonicalName === kernel.characterId) continue;
	const canonical = hit.entry.canonicalName;
	if (getCharacterKernel(storage, bookId, canonical)) {
		kernelConflictSkipped++;
		console.warn(`⚠️ 跳过「${kernel.characterId}」：canonical 名「${canonical}」已有内核，请手动合并。`);
		continue;
	}
	upsertCharacterKernel(storage, {
		...kernel,
		id: `kernel:${bookId}:${canonical}`,
		characterId: canonical,
	});
	deleteCharacterKernel(storage, bookId, kernel.characterId);
	kernelRenamed++;
}

console.log(`character_kernel: 扫描 ${kernelScanned} 条，迁移 ${kernelRenamed} 条，冲突跳过 ${kernelConflictSkipped} 条`);
console.log("\n回填完成。");
