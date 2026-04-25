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

export const bibleConflicts = sqliteTable(
  "bible_conflict",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    scope: text("scope").notNull().default("arc"),
    priority: integer("priority").notNull().default(3),
    protagonistSideJson: text("protagonist_side_json").notNull().default("[]"),
    antagonistSideJson: text("antagonist_side_json").notNull().default("[]"),
    stakes: text("stakes").notNull().default(""),
    rootCauseJson: text("root_cause_json").notNull().default("{}"),
    evolutionPathJson: text("evolution_path_json").notNull().default("[]"),
    resolutionState: text("resolution_state").notNull().default("unborn"),
    resolutionChapter: integer("resolution_chapter"),
    relatedConflictIdsJson: text("related_conflict_ids_json").notNull().default("[]"),
    visibilityRuleJson: text("visibility_rule_json").notNull().default('{"type":"tracked"}'),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("bible_conflict_book_status_idx").on(table.bookId, table.resolutionState),
    index("bible_conflict_book_priority_idx").on(table.bookId, table.priority),
  ],
);

export const bibleWorldModels = sqliteTable(
  "bible_world_model",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .unique()
      .references(() => books.id, { onDelete: "cascade" }),
    economyJson: text("economy_json").notNull().default("{}"),
    societyJson: text("society_json").notNull().default("{}"),
    geographyJson: text("geography_json").notNull().default("{}"),
    powerSystemJson: text("power_system_json").notNull().default("{}"),
    cultureJson: text("culture_json").notNull().default("{}"),
    timelineJson: text("timeline_json").notNull().default("{}"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("bible_world_model_book_id_idx").on(table.bookId)],
);

export const biblePremises = sqliteTable(
  "bible_premise",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .unique()
      .references(() => books.id, { onDelete: "cascade" }),
    logline: text("logline").notNull().default(""),
    themeJson: text("theme_json").notNull().default("[]"),
    tone: text("tone").notNull().default(""),
    targetReaders: text("target_readers").notNull().default(""),
    uniqueHook: text("unique_hook").notNull().default(""),
    genreTagsJson: text("genre_tags_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("bible_premise_book_id_idx").on(table.bookId)],
);

export const bibleCharacterArcs = sqliteTable(
  "bible_character_arc",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => bibleCharacters.id, { onDelete: "cascade" }),
    arcType: text("arc_type").notNull(),
    startingState: text("starting_state").notNull().default(""),
    endingState: text("ending_state").notNull().default(""),
    keyTurningPointsJson: text("key_turning_points_json").notNull().default("[]"),
    currentPosition: text("current_position").notNull().default(""),
    visibilityRuleJson: text("visibility_rule_json").notNull().default('{"type":"global"}'),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("bible_character_arc_book_character_idx").on(table.bookId, table.characterId)],
);

export const questionnaireTemplates = sqliteTable(
  "questionnaire_template",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull(),
    genreTagsJson: text("genre_tags_json").notNull().default("[]"),
    tier: integer("tier").notNull(),
    targetObject: text("target_object").notNull(),
    questionsJson: text("questions_json").notNull(),
    isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("questionnaire_template_id_version_idx").on(table.id, table.version),
    index("questionnaire_template_tier_idx").on(table.tier),
  ],
);

export const questionnaireResponses = sqliteTable(
  "questionnaire_response",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull(),
    targetObjectType: text("target_object_type").notNull(),
    targetObjectId: text("target_object_id"),
    answersJson: text("answers_json").notNull(),
    status: text("status").notNull().default("draft"),
    answeredVia: text("answered_via").notNull().default("author"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("questionnaire_response_book_template_idx").on(table.bookId, table.templateId),
    index("questionnaire_response_book_status_idx").on(table.bookId, table.status),
  ],
);

export const coreShifts = sqliteTable(
  "core_shift",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    fromSnapshotJson: text("from_snapshot_json").notNull(),
    toSnapshotJson: text("to_snapshot_json").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    chapterAt: integer("chapter_at").notNull(),
    affectedChaptersJson: text("affected_chapters_json").notNull().default("[]"),
    impactAnalysisJson: text("impact_analysis_json").notNull().default("{}"),
    status: text("status").notNull().default("proposed"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("core_shift_book_status_idx").on(table.bookId, table.status)],
);

export const drizzleMigrations = sqliteTable("drizzle_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hash: text("hash").notNull().unique(),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
