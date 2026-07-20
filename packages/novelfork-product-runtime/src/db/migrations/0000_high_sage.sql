CREATE TABLE `book_provision_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`book_id` text NOT NULL,
	`title` text NOT NULL,
	`input_json` text NOT NULL,
	`state` text NOT NULL,
	`runtime_project_id` text,
	`runtime_chapter_id` text,
	`narrator_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_provision_operations_book_id_unique` ON `book_provision_operations` (`book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_provision_actor_idempotency` ON `book_provision_operations` (`actor_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_provision_book` ON `book_provision_operations` (`book_id`);--> statement-breakpoint
CREATE INDEX `idx_book_provision_actor_state` ON `book_provision_operations` (`actor_user_id`,`state`);--> statement-breakpoint
CREATE TABLE `book_runtime_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime_project_id` text NOT NULL,
	`book_id` text NOT NULL,
	`book_root` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_runtime_bindings_runtime_project_id_unique` ON `book_runtime_bindings` (`runtime_project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `book_runtime_bindings_book_id_unique` ON `book_runtime_bindings` (`book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_runtime_bindings_project` ON `book_runtime_bindings` (`runtime_project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_book_runtime_bindings_book` ON `book_runtime_bindings` (`book_id`);--> statement-breakpoint
CREATE TABLE `novelfork_legacy_session_imports` (
	`source_session_id` text PRIMARY KEY NOT NULL,
	`narrator_id` text NOT NULL,
	`source_updated_at` text NOT NULL,
	`summary_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`imported_at` text,
	`error_message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novelfork_legacy_session_imports_narrator_id_unique` ON `novelfork_legacy_session_imports` (`narrator_id`);--> statement-breakpoint
CREATE TABLE `novelfork_runtime_compatibility_transfers` (
	`source_table` text NOT NULL,
	`source_key` text NOT NULL,
	`source_hash` text NOT NULL,
	`transferred_at` text NOT NULL,
	PRIMARY KEY(`source_table`, `source_key`)
);
