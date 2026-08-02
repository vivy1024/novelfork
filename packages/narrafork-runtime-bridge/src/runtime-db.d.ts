/**
 * Declaration-only view of the Runtime Bun Drizzle tree.
 *
 * These re-exports resolve package declarations from the isolated Runtime
 * installation without pulling Runtime server source into a PNPM consumer's
 * TypeScript program.
 */
export { and, desc, eq, inArray, ne } from "../../narrafork-runtime-private/node_modules/drizzle-orm";
export { drizzle, type BunSQLiteDatabase } from "../../narrafork-runtime-private/node_modules/drizzle-orm/bun-sqlite";
export { index, primaryKey, sqliteTable, text, uniqueIndex } from "../../narrafork-runtime-private/node_modules/drizzle-orm/sqlite-core";

export function getDbDir(): string;
export function getDbPath(): string;
