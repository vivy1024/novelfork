/**
 * Product-level user force-delete route.
 *
 * The upstream Runtime DELETE /api/admin/users/:id can fail when legacy rows
 * still reference the user. This route performs the product cleanup in one
 * transaction while keeping SQLite foreign-key enforcement enabled.
 */
import { Hono } from "hono";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

type Env = { Variables: { user: { sub: string; role: "admin" | "user" } } };

type SqliteDatabase = ReturnType<typeof getStorageDatabase>["sqlite"];

const OPTIONAL_USER_ROWS = [
  ["user_identities", "user_id"],
  ["user_mfa_backup_codes", "user_id"],
  ["user_passkeys", "user_id"],
  ["user_totp", "user_id"],
  ["user_favorite_directories", "user_id"],
  ["user_recent_tabs", "user_id"],
  ["user_recent_tabs_meta", "user_id"],
  ["user_plugin_themes", "user_id"],
  ["webauthn_challenges", "user_id"],
  ["gateway_session_mappings", "user_id"],
  ["terminal_view_state", "user_id"],
] as const;

function tableExists(db: SqliteDatabase, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db: SqliteDatabase, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(\"${table}\")`).all() as Array<{ name?: string }>;
  return columns.some((entry) => entry.name === column);
}

function deleteOptionalUserRows(db: SqliteDatabase, userId: string): void {
  for (const [table, column] of OPTIONAL_USER_ROWS) {
    if (!columnExists(db, table, column)) continue;
    db.prepare(`DELETE FROM \"${table}\" WHERE \"${column}\" = ?`).run(userId);
  }
}

function cleanupUserRows(db: SqliteDatabase, userId: string): void {
  // These columns intentionally preserve messages after user deletion, but
  // their historical FK definitions did not specify ON DELETE SET NULL.
  if (tableExists(db, "narrator_messages")) {
    db.prepare(
      "UPDATE narrator_messages SET created_by = NULL, edited_by = NULL WHERE created_by = ? OR edited_by = ?",
    ).run(userId, userId);
  }
  if (tableExists(db, "chat_groups")) {
    db.prepare("UPDATE chat_groups SET created_by = NULL WHERE created_by = ?").run(userId);
  }
  if (tableExists(db, "chat_group_messages")) {
    db.prepare("UPDATE chat_group_messages SET sender_user_id = NULL WHERE sender_user_id = ?").run(userId);
  }
  if (tableExists(db, "chat_group_members")) {
    db.prepare("DELETE FROM chat_group_members WHERE user_id = ?").run(userId);
  }

  deleteOptionalUserRows(db, userId);
  if (tableExists(db, "oauth_grants")) {
    db.prepare("DELETE FROM oauth_grants WHERE user_id = ?").run(userId);
  }
  if (tableExists(db, "knowledge_grants")) {
    db.prepare("DELETE FROM knowledge_grants WHERE principal_type = 'user' AND principal_id = ?").run(userId);
  }
}

export const adminUserCleanupRoutes = new Hono<Env>();

adminUserCleanupRoutes.delete("/api/product/admin/users/:id/force", async (c) => {
  const caller = c.get("user");
  if (caller.role !== "admin") {
    return c.json({ error: "Admin required" }, 403);
  }

  const targetId = c.req.param("id");
  if (targetId === caller.sub) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }

  const storage = getStorageDatabase();
  const db = storage.sqlite;

  const target = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(targetId) as
    | { id: string; username: string; role: string }
    | undefined;
  if (!target) {
    return c.json({ error: "User not found" }, 404);
  }

  if (target.role === "admin") {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get() as { cnt: number };
    if (row.cnt <= 1) {
      return c.json({ error: "Cannot delete the last administrator" }, 400);
    }
  }

  // Never disable FK enforcement: CASCADE/SET NULL relationships must remain
  // active, and any unexpected restrictive FK must roll the whole operation back.
  db.exec("PRAGMA foreign_keys = ON");
  const deleteUser = db.transaction((userId: string) => {
    cleanupUserRows(db, userId);
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    if (result.changes !== 1) throw new Error("User deletion did not remove exactly one row.");
  });

  try {
    deleteUser(targetId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }

  return c.json({ ok: true, deleted: target.username });
});
