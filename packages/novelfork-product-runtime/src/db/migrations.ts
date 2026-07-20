import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { embeddedProductMigrationSqlFiles } from "./generated-migrations-data";

export interface ProductMigrationResult {
	readonly applied: string[];
}

type ProductMigrationFile = {
	readonly name: string;
	readonly content: string;
};

function resolveProductMigrationsDir(): string | undefined {
	const moduleDir = fileURLToPath(new URL("./migrations", import.meta.url));
	const candidates = [
		moduleDir,
		resolve(process.cwd(), "src", "db", "migrations"),
		resolve(process.cwd(), "packages", "novelfork-product-runtime", "src", "db", "migrations"),
		resolve(process.cwd(), "..", "novelfork-product-runtime", "src", "db", "migrations"),
	];
	return candidates.find((candidate) => existsSync(candidate));
}

function readProductMigrationFiles(migrationsDir?: string): readonly ProductMigrationFile[] {
	const directory = migrationsDir ?? resolveProductMigrationsDir();
	if (directory && existsSync(directory)) {
		const files = readdirSync(directory)
			.filter((entry) => /^\d+.*\.sql$/u.test(entry))
			.sort((left, right) => left.localeCompare(right));
		if (files.length === 0) throw new Error("NovelFork product migrations directory is empty.");
		return files.map((name) => ({
			name,
			content: readFileSync(resolve(directory, name), "utf8"),
		}));
	}

	if (embeddedProductMigrationSqlFiles.length > 0) return embeddedProductMigrationSqlFiles;
	throw new Error("NovelFork product migrations directory was not found.");
}

function migrationHash(sql: string): string {
	return createHash("sha256").update(sql).digest("hex");
}

function isAlreadyAppliedStatementError(error: unknown): boolean {
	const message = String(error).toLowerCase();
	return message.includes("already exists") || message.includes("duplicate column name");
}

function applyMigrationStatements(storage: StorageDatabase, sql: string): void {
	for (const statement of sql
		.split("--> statement-breakpoint")
		.map((value) => value.trim())
		.filter(Boolean)) {
		try {
			storage.sqlite.exec(statement);
		} catch (error) {
			if (!isAlreadyAppliedStatementError(error)) throw error;
		}
	}
}

export function runNovelForkProductMigrations(
	storage: StorageDatabase,
	migrationsDir?: string,
): ProductMigrationResult {
	storage.sqlite.exec(`
		CREATE TABLE IF NOT EXISTS "novelfork_product_migrations" (
			"id" INTEGER PRIMARY KEY AUTOINCREMENT,
			"hash" TEXT NOT NULL UNIQUE,
			"name" TEXT NOT NULL UNIQUE,
			"created_at" INTEGER NOT NULL
		);
	`);
	const files = readProductMigrationFiles(migrationsDir);

	const appliedRows = storage.sqlite
		.prepare<{ name: string; hash: string }>(
			`SELECT "name", "hash" FROM "novelfork_product_migrations"`,
		)
		.all();
	const appliedByName = new Map(appliedRows.map((row) => [row.name, row.hash]));
	const appliedByHash = new Map(appliedRows.map((row) => [row.hash, row.name]));
	const record = storage.sqlite.prepare(
		`INSERT INTO "novelfork_product_migrations" ("hash", "name", "created_at") VALUES (?, ?, ?)`,
	);
	const apply = storage.sqlite.transaction((name: string, sql: string, hash: string) => {
		applyMigrationStatements(storage, sql);
		record.run(hash, name, Date.now());
	});
	const applied: string[] = [];

	for (const file of files) {
		const hash = migrationHash(file.content);
		const existingHash = appliedByName.get(file.name);
		if (existingHash) {
			if (existingHash !== hash) {
				throw new Error(`NovelFork product migration ${file.name} changed after it was applied.`);
			}
			continue;
		}
		if (appliedByHash.has(hash)) continue;
		apply(file.name, file.content, hash);
		applied.push(file.name);
		appliedByName.set(file.name, hash);
		appliedByHash.set(hash, file.name);
	}

	return { applied };
}
