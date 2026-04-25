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

export const books = sqliteTable("book", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bibleMode: text("bible_mode", { enum: ["static", "dynamic"] }).notNull().default("static"),
  currentChapter: integer("current_chapter").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const bibleCharacters = sqliteTable(
  "bible_character",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    roleType: text("role_type").notNull().default("minor"),
    summary: text("summary").notNull().default(""),
    traitsJson: text("traits_json").notNull().default("{}"),
    visibilityRuleJson: text("visibility_rule_json").notNull().default('{"type":"global"}'),
    firstChapter: integer("first_chapter"),
    lastChapter: integer("last_chapter"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("bible_character_book_id_idx").on(table.bookId)],
);

export const bibleEvents = sqliteTable(
  "bible_event",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eventType: text("event_type").notNull(),
    chapterStart: integer("chapter_start"),
    chapterEnd: integer("chapter_end"),
    summary: text("summary").notNull().default(""),
    relatedCharacterIdsJson: text("related_character_ids_json").notNull().default("[]"),
    visibilityRuleJson: text("visibility_rule_json").notNull().default('{"type":"tracked"}'),
    foreshadowState: text("foreshadow_state"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("bible_event_book_id_idx").on(table.bookId)],
);

export const bibleSettings = sqliteTable(
  "bible_setting",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull().default(""),
    visibilityRuleJson: text("visibility_rule_json").notNull().default('{"type":"global"}'),
    nestedRefsJson: text("nested_refs_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("bible_setting_book_id_idx").on(table.bookId)],
);

export const bibleChapterSummaries = sqliteTable(
  "bible_chapter_summary",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    keyEventsJson: text("key_events_json").notNull().default("[]"),
    appearingCharacterIdsJson: text("appearing_character_ids_json").notNull().default("[]"),
    pov: text("pov").notNull().default(""),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("bible_chapter_summary_book_chapter_idx").on(table.bookId, table.chapterNumber),
    index("bible_chapter_summary_book_id_idx").on(table.bookId),
  ],
);

export const drizzleMigrations = sqliteTable("drizzle_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hash: text("hash").notNull().unique(),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
