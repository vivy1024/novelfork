import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  messageCount: integer("message_count").notNull().default(0),
  configJson: text("config_json").notNull().default("{}"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const sessionMessages = sqliteTable(
  "session_message",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    id: text("id").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.seq] }),
    uniqueIndex("session_message_session_id_id_idx").on(table.sessionId, table.id),
    index("session_message_session_id_seq_desc_idx").on(table.sessionId, table.seq),
  ],
);

export const sessionMessageCursors = sqliteTable("session_message_cursor", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  lastSeq: integer("last_seq").notNull().default(0),
  availableFromSeq: integer("available_from_seq").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const kvStore = sqliteTable("kv_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const drizzleMigrations = sqliteTable("drizzle_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hash: text("hash").notNull().unique(),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
