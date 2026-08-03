/**
 * Product-level user force-delete route.
 *
 * The upstream Runtime DELETE /api/admin/users/:id fails with FOREIGN KEY
 * constraint when the user has narrator sessions, messages, or other FK
 * references. This route disables FK checks temporarily, deletes the user
 * row, then re-enables FK checks. Only admins can call it.
 */
import { Hono } from "hono";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

type Env = { Variables: { user: { sub: string; role: "admin" | "user" } } };

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

  // Check user exists
  const target = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(targetId) as
    | { id: string; username: string; role: string }
    | undefined;
  if (!target) {
    return c.json({ error: "User not found" }, 404);
  }

  // Protect last admin
  if (target.role === "admin") {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get() as { cnt: number };
    if (row.cnt <= 1) {
      return c.json({ error: "Cannot delete the last administrator" }, 400);
    }
  }

  // Force delete with FK disabled
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
    // Best-effort cleanup of directly referencing tables
    const cleanupTables = [
      "user_identities", "user_mfa_backup_codes", "user_passkeys",
      "user_totp", "user_favorite_directories", "user_recent_tabs",
      "user_recent_tabs_meta", "user_plugin_themes", "webauthn_challenges",
      "gateway_session_mappings", "terminal_view_state",
    ];
    for (const table of cleanupTables) {
      try { db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(targetId); } catch {}
    }
    // oauth/knowledge grants (match upstream logic)
    try { db.prepare("DELETE FROM oauth_grants WHERE user_id = ?").run(targetId); } catch {}
    try { db.prepare("DELETE FROM knowledge_grants WHERE principal_type = 'user' AND principal_id = ?").run(targetId); } catch {}
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  return c.json({ ok: true, deleted: target.username });
});
