import { describe, expect, test } from "bun:test";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import {
	checkStartupStorageIntegrity,
	explainDamagedStorageIntegrity,
	isDamagedIntegrityReport,
} from "./storage-integrity";

/**
 * B2 红测：启动完整性检查必须有消费者。
 *
 * core 在建连时跑 `PRAGMA integrity_check` 并把结果挂在 `storage.startupIntegrity` 上，
 * 但修复前**没有任何生产代码读它**——检查白做：库已损坏时产品照常启动、照常让作者写，
 * 作者只看到零散报错，不知道整库已经不可信。
 *
 * 这里钉住三件事：
 *   1. 健康（"ok"）与内存库（undefined）都不告警，不能把正常启动报成故障；
 *   2. 损坏时产出带三段式 explanation 的 persistent 告警，原始报告原样带出；
 *   3. 真损坏库上建连不抛错，消费者如实报出来——启动不被阻断（与 core 的取舍一致）。
 *
 * 临时目录放在仓库内被忽略的 `packages/novelfork-product-runtime/tmp/`（本仓库约定测试不在仓库外写文件）。
 */

const TMP_ROOT = join(process.cwd(), "tmp", "storage-integrity");
mkdirSync(TMP_ROOT, { recursive: true });

function scratch(): string {
	return mkdtempSync(join(TMP_ROOT, "case-"));
}

function fakeStorage(overrides: Partial<StorageDatabase>): StorageDatabase {
	return {
		databasePath: "C:/fake/novelfork.db",
		startupIntegrity: "ok",
		...overrides,
	} as StorageDatabase;
}

describe("启动完整性检查的消费者（B2 红测）", () => {
	test("健康报告与内存库都不产生告警", () => {
		expect(isDamagedIntegrityReport("ok")).toBe(false);
		expect(isDamagedIntegrityReport(undefined)).toBe(false);
		expect(isDamagedIntegrityReport("")).toBe(false);
		expect(checkStartupStorageIntegrity(fakeStorage({ startupIntegrity: "ok" }))).toBeNull();
		expect(checkStartupStorageIntegrity(fakeStorage({ startupIntegrity: undefined }))).toBeNull();
	});

	test("损坏报告产出带三段式解释的 persistent 告警，原始报告原样带出", () => {
		const report = "*** in database main ***\nPage 5 is never used";
		const alert = checkStartupStorageIntegrity(
			fakeStorage({ databasePath: "C:/data/novelfork.db", startupIntegrity: report }),
		);

		expect(alert).not.toBeNull();
		expect(alert!.code).toBe("STORAGE_INTEGRITY_DAMAGED");
		expect(alert!.kind).toBe("persistent");
		expect(alert!.storagePath).toBe("C:/data/novelfork.db");
		// 原始报告必须原样带出：作者与支持者要靠它判断损坏范围。
		expect(alert!.report).toBe(report);
		expect(alert!.explanation.whatHappened).toContain(report);
		for (const part of ["whatHappened", "whyItMatters", "suggestedAction"] as const) {
			expect(alert!.explanation[part].trim().length).toBeGreaterThan(0);
		}
		// 建议必须先留档再恢复：直接删库会丢掉唯一的数据来源。
		expect(alert!.explanation.suggestedAction).toContain("导出");
	});

	test("真损坏库：建连不抛错，消费者如实报出而不静默", () => {
		const dir = scratch();
		const databasePath = join(dir, "novelfork.db");

		const healthy = createStorageDatabase({ databasePath });
		let rootPage = 0;
		try {
			healthy.sqlite.exec(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "v" TEXT);`);
			for (let i = 0; i < 400; i += 1) {
				healthy.sqlite.run(`INSERT INTO "t" ("id", "v") VALUES (?, ?)`, `row-${i}`, "x".repeat(200));
			}
			healthy.checkpoint();
			rootPage = healthy.sqlite
				.prepare<{ rootpage: number }>(`SELECT rootpage FROM sqlite_master WHERE name = 't'`)
				.get()!.rootpage;
		} finally {
			healthy.close();
		}

		// 直接改写表根页中部的字节（页号从 1 起，偏移 (rootpage-1)*4096），让结构在磁盘上确定性地损坏。
		const fd = openSync(databasePath, "r+");
		try {
			writeSync(fd, new Uint8Array(256).fill(0xab), 0, 256, (rootPage - 1) * 4096 + 8);
		} finally {
			closeSync(fd);
		}

		// 建连不得因损坏而抛错，并且必须留下真实可读的报告。
		const storage = createStorageDatabase({ databasePath });
		try {
			expect(typeof storage.startupIntegrity).toBe("string");
			expect(storage.startupIntegrity).not.toBe("ok");
			const alert = checkStartupStorageIntegrity(storage);
			expect(alert).not.toBeNull();
			expect(alert!.report.trim().length).toBeGreaterThan(0);
		} finally {
			storage.close();
		}
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});

	test("explainDamagedStorageIntegrity 的三段式都引用真实路径与报告，不写死文案", () => {
		const explanation = explainDamagedStorageIntegrity("D:/Books/novelfork.db", "page 3 is never used");
		expect(explanation.whatHappened).toContain("D:/Books/novelfork.db");
		expect(explanation.whatHappened).toContain("page 3 is never used");
		expect(explanation.whyItMatters).toContain("作品");
	});
});
