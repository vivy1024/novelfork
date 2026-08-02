import { index, primaryKey, sqliteTable, text, uniqueIndex } from "@vivy1024/narrafork-runtime-bridge/runtime-db";

export const bookRuntimeBindings = sqliteTable(
	"book_runtime_bindings",
	{
		id: text("id").primaryKey(),
		runtimeProjectId: text("runtime_project_id").notNull().unique(),
		bookId: text("book_id").notNull().unique(),
		bookRoot: text("book_root").notNull(),
		createdByUserId: text("created_by_user_id"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_book_runtime_bindings_project").on(table.runtimeProjectId),
		uniqueIndex("idx_book_runtime_bindings_book").on(table.bookId),
	],
);

export const bookProvisionOperations = sqliteTable(
	"book_provision_operations",
	{
		id: text("id").primaryKey(),
		actorUserId: text("actor_user_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		bookId: text("book_id").notNull().unique(),
		title: text("title").notNull(),
		inputJson: text("input_json", { mode: "json" }).notNull(),
		state: text("state", {
			enum: [
				"reserved",
				"core-staged",
				"filesystem-promoted",
				"runtime-bound",
				"ready",
				"failed",
				"compensation-required",
			],
		}).notNull(),
		runtimeProjectId: text("runtime_project_id"),
		runtimeChapterId: text("runtime_chapter_id"),
		narratorId: text("narrator_id"),
		errorMessage: text("error_message"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_book_provision_actor_idempotency").on(
			table.actorUserId,
			table.idempotencyKey,
		),
		uniqueIndex("idx_book_provision_book").on(table.bookId),
		index("idx_book_provision_actor_state").on(table.actorUserId, table.state),
	],
);

export const novelforkLegacySessionImports = sqliteTable("novelfork_legacy_session_imports", {
	sourceSessionId: text("source_session_id").primaryKey(),
	narratorId: text("narrator_id").notNull().unique(),
	sourceUpdatedAt: text("source_updated_at").notNull(),
	summaryHash: text("summary_hash").notNull(),
	status: text("status", { enum: ["pending", "done", "error"] })
		.notNull()
		.default("pending"),
	importedAt: text("imported_at"),
	errorMessage: text("error_message"),
});

export const runtimeCompatibilityTransfers = sqliteTable(
	"novelfork_runtime_compatibility_transfers",
	{
		sourceTable: text("source_table").notNull(),
		sourceKey: text("source_key").notNull(),
		sourceHash: text("source_hash").notNull(),
		transferredAt: text("transferred_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.sourceTable, table.sourceKey] })],
);
