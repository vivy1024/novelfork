import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { getDbPath } from "@vivy1024/narrafork-runtime-bridge/runtime-db";

type TransferValue = string | number | null;
type TransferRow = Record<string, TransferValue>;

type TransferTable = {
	readonly name: string;
	readonly primaryKey: string;
	readonly columns: readonly string[];
};

const TRANSFER_TABLES: readonly TransferTable[] = [
	{
		name: "book_runtime_bindings",
		primaryKey: "id",
		columns: [
			"id",
			"runtime_project_id",
			"book_id",
			"book_root",
			"created_by_user_id",
			"created_at",
			"updated_at",
		],
	},
	{
		name: "book_provision_operations",
		primaryKey: "id",
		columns: [
			"id",
			"actor_user_id",
			"idempotency_key",
			"book_id",
			"title",
			"input_json",
			"state",
			"runtime_project_id",
			"runtime_chapter_id",
			"narrator_id",
			"error_message",
			"created_at",
			"updated_at",
		],
	},
	{
		name: "novelfork_legacy_session_imports",
		primaryKey: "source_session_id",
		columns: [
			"source_session_id",
			"narrator_id",
			"source_updated_at",
			"summary_hash",
			"status",
			"imported_at",
			"error_message",
		],
	},
];

export interface RuntimeCompatibilityTransferResult {
	readonly copied: number;
	readonly skipped: number;
	readonly missingTables: string[];
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function sourceTableExists(source: Database, tableName: string): boolean {
	return Boolean(
		source
			.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
			.get(tableName),
	);
}

function rowHash(table: TransferTable, row: TransferRow): string {
	return createHash("sha256")
		.update(JSON.stringify(table.columns.map((column) => row[column] ?? null)))
		.digest("hex");
}

function targetRowExists(
	storage: StorageDatabase,
	table: TransferTable,
	primaryKeyValue: TransferValue,
): boolean {
	return Boolean(
		storage.sqlite
			.prepare(
				`SELECT 1 AS present FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(table.primaryKey)} = ? LIMIT 1`,
			)
			.get(primaryKeyValue),
	);
}

function targetRowMatches(
	storage: StorageDatabase,
	table: TransferTable,
	row: TransferRow,
): boolean {
	const selected = storage.sqlite
		.prepare<TransferRow>(
			`SELECT ${table.columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(table.primaryKey)} = ? LIMIT 1`,
		)
		.get(row[table.primaryKey]);
	return Boolean(
		selected &&
			table.columns.every((column) => (selected[column] ?? null) === (row[column] ?? null)),
	);
}

function transferRow(
	storage: StorageDatabase,
	table: TransferTable,
	row: TransferRow,
): "copied" | "skipped" {
	const sourceKey = String(row[table.primaryKey]);
	const hash = rowHash(table, row);
	const ledger = storage.sqlite
		.prepare<{ source_hash: string }>(
			`SELECT source_hash FROM novelfork_runtime_compatibility_transfers WHERE source_table = ? AND source_key = ?`,
		)
		.get(table.name, sourceKey);
	if (
		ledger?.source_hash === hash &&
		targetRowExists(storage, table, row[table.primaryKey])
	) {
		return "skipped";
	}

	const columns = table.columns.map(quoteIdentifier).join(", ");
	const placeholders = table.columns.map(() => "?").join(", ");
	const updateSet = table.columns
		.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
		.join(", ");
	const upsert = storage.sqlite.prepare(
		`INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders}) ON CONFLICT DO UPDATE SET ${updateSet}`,
	);
	const recordLedger = storage.sqlite.prepare(
		`INSERT INTO novelfork_runtime_compatibility_transfers (source_table, source_key, source_hash, transferred_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(source_table, source_key) DO UPDATE SET
		   source_hash = excluded.source_hash,
		   transferred_at = excluded.transferred_at`,
	);
	const apply = storage.sqlite.transaction(() => {
		upsert.run(...table.columns.map((column) => row[column] ?? null));
		if (!targetRowMatches(storage, table, row)) {
			throw new Error(`Compatibility transfer verification failed for ${table.name}:${sourceKey}`);
		}
		recordLedger.run(table.name, sourceKey, hash, new Date().toISOString());
	});
	apply();
	return "copied";
}

export function transferRuntimeProductData(
	storage: StorageDatabase,
	sourceDatabasePath = getDbPath(),
): RuntimeCompatibilityTransferResult {
	const result: { copied: number; skipped: number; missingTables: string[] } = {
		copied: 0,
		skipped: 0,
		missingTables: [],
	};
	if (!existsSync(sourceDatabasePath)) {
		result.missingTables.push(...TRANSFER_TABLES.map((table) => table.name));
		return result;
	}
	if (
		storage.databasePath !== ":memory:" &&
		resolve(storage.databasePath) === resolve(sourceDatabasePath)
	) {
		return result;
	}

	const source = new Database(sourceDatabasePath, { readonly: true });
	try {
		for (const table of TRANSFER_TABLES) {
			if (!sourceTableExists(source, table.name)) {
				result.missingTables.push(table.name);
				continue;
			}
			const rows = source
				.query(
					`SELECT ${table.columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table.name)}`,
				)
				.all() as TransferRow[];
			for (const row of rows) result[transferRow(storage, table, row)] += 1;
		}
	} finally {
		source.close();
	}
	return result;
}
