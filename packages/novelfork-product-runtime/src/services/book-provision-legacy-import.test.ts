import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repairLegacyImportTail } from "./book-provision";

// 旧版「导入已有作品目录」写出的结尾：字面的反斜杠 + n（不是换行）。
const LITERAL_TAIL = String.fromCharCode(92) + "n";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "novelfork-legacy-import-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("repairLegacyImportTail", () => {
	test("末尾是字面反斜杠 + n 且去掉后能解析：改写为正常换行", async () => {
		const path = join(dir, "book.json");
		const raw = `${JSON.stringify({ id: "b1", title: "旧导入" }, null, 2)}${LITERAL_TAIL}`;
		await writeFile(path, raw, "utf8");
		expect(() => JSON.parse(raw)).toThrow();

		const repaired = await repairLegacyImportTail(path, raw);
		expect(JSON.parse(repaired)).toEqual({ id: "b1", title: "旧导入" });
		expect(repaired.endsWith("\n")).toBe(true);
		expect(await readFile(path, "utf8")).toBe(repaired);
	});

	test("章节索引「[]」加字面结尾同样修复", async () => {
		const path = join(dir, "index.json");
		await writeFile(path, `[]${LITERAL_TAIL}`, "utf8");
		expect(JSON.parse(await repairLegacyImportTail(path, `[]${LITERAL_TAIL}`))).toEqual([]);
	});

	test("正常文件与其他损坏原样保留，不改写", async () => {
		const path = join(dir, "book.json");
		const normal = `${JSON.stringify({ id: "b1" })}\n`;
		await writeFile(path, normal, "utf8");
		expect(await repairLegacyImportTail(path, normal)).toBe(normal);

		const broken = `{"id": "b1",${LITERAL_TAIL}`;
		await writeFile(path, broken, "utf8");
		expect(await repairLegacyImportTail(path, broken)).toBe(broken);
		expect(await readFile(path, "utf8")).toBe(broken);
	});
});
