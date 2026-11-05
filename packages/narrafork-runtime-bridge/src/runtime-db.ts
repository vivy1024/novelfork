// Product Runtime uses one isolated Drizzle tree for both Runtime and product
// schemas. Re-export the minimal construction and query surface so public code
// never combines PNPM's Drizzle declarations with Runtime's Bun installation.
export { and, desc, eq, inArray, ne, sql } from "../../narrafork-runtime-private/node_modules/drizzle-orm";
export { drizzle, type BunSQLiteDatabase } from "../../narrafork-runtime-private/node_modules/drizzle-orm/bun-sqlite";
export { index, primaryKey, sqliteTable, text, uniqueIndex } from "../../narrafork-runtime-private/node_modules/drizzle-orm/sqlite-core";
export { getDbDir, getDbPath } from "../../narrafork-runtime-private/server/db/connection";
