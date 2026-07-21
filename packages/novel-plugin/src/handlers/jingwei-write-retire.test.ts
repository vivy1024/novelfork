import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeStorageDatabase,
	initializeStorageDatabase,
	runStorageMigrations,
	type StorageDatabase,
} from "@vivy1024/novelfork-core";
import { handleJingweiWrite } from "./jingwei-write-handler.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
	const dir = join(tmpdir(), `novelfork-jingwei-write-retire-${crypto.randomUUID()}`);
	await mkdir(dir, { recursive: true });
	tempDirs.push(dir);
	const storage = initializeStorageDatabase({ databasePath: join(dir, "novelfork.db") });
	runStorageMigrations(storage);
	const now = Date.now();
	storage.sqlite
		.prepare(
			`INSERT INTO book (id, name, jingwei_mode, current_chapter, created_at, updated_at)
       VALUES ('book-1', '测试书', 'dynamic', 0, ?, ?)`,
		)
		.run(now, now);
	storage.sqlite
		.prepare(
			`INSERT INTO story_jingwei_section (
        id, book_id, key, name, description, "order", enabled, show_in_sidebar,
        participates_in_ai, default_visibility, fields_json, created_at, updated_at
      ) VALUES (?, 'book-1', 'factions', '势力', '', 0, 1, 1, 1, 'tracked', '[]', ?, ?)`,
		)
		.run("sec-factions", now, now);
	storage.sqlite
		.prepare(
			`INSERT INTO story_jingwei_entry (
        id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json,
        related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai,
        category, fields_json, sort_order, lifecycle, layer, importance, source, revision_history,
        conflict_status, status, version, created_at, updated_at
      ) VALUES (
        'canon-bad', 'book-1', 'sec-factions', '书籍前提', ?,
        '[]', '[]', '{}', '[]', '[]', '{"type":"tracked"}', 1,
        'factions', '{}', 0, 'active', 'canon', 90, 'user', '[]',
        'none', 'confirmed', 1, ?, ?
      )`,
		)
		.run("# 书籍前提\n\n2025年灵启，错误世界线。", now, now);
	return storage;
}

describe("lore.write / jingwei.write retire", () => {
	let storage: StorageDatabase;

	beforeEach(async () => {
		storage = await createStorage();
	});

	afterEach(async () => {
		closeStorageDatabase();
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	test("delete on canon fails with retire guidance", async () => {
		const result = await handleJingweiWrite({
			bookId: "book-1",
			action: "delete",
			title: "书籍前提",
			entryId: "canon-bad",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("canon-immutable");
			expect(result.summary).toContain("retire");
		}
	});

	test("retire without confirmCanonEdit fails for canon", async () => {
		const result = await handleJingweiWrite({
			bookId: "book-1",
			action: "retire",
			title: "书籍前提",
			entryId: "canon-bad",
			reason: "错误世界线",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("canon-confirm-required");
		}
	});

	test("retire with confirmCanonEdit opts canon out of AI without changing layer/content", async () => {
		const result = await handleJingweiWrite({
			bookId: "book-1",
			action: "retire",
			title: "书籍前提",
			entryId: "canon-bad",
			confirmCanonEdit: true,
			reason: "factions 误放；含 2025年灵启；权威在 premise",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.action).toBe("retired");
			expect(result.data.layer).toBe("canon");
		}
		const row = storage.sqlite
			.prepare(
				`SELECT layer, content_md, participates_in_ai, deleted_at, lifecycle, status, conflict_status
         FROM story_jingwei_entry WHERE id = 'canon-bad'`,
			)
			.get() as {
			layer: string;
			content_md: string;
			participates_in_ai: number;
			deleted_at: number | null;
			lifecycle: string;
			status: string;
			conflict_status: string;
		};
		expect(row.layer).toBe("canon");
		expect(row.content_md).toContain("2025年灵启");
		expect(row.participates_in_ai).toBe(0);
		expect(row.deleted_at).not.toBeNull();
		expect(row.lifecycle).toBe("archived");
		expect(row.status).toBe("needs-review");
		expect(row.conflict_status).toBe("superseded");
		const rev = storage.sqlite
			.prepare(`SELECT reason, changed_by FROM jingwei_revision WHERE entry_id = 'canon-bad'`)
			.get() as { reason: string; changed_by: string };
		expect(rev.changed_by).toBe("agent-retire");
		expect(rev.reason).toContain("2025");
	});
});
