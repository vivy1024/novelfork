/**
 * User Store — SQLite-backed user CRUD
 *
 * Uses the existing session storage database (getSessionStorageDatabase).
 * Creates `auth_users` table on first access via lazy migration.
 */

import { getSessionStorageDatabase } from "./session-storage.js";
import { hashPassword } from "./user-auth.js";
import type { AuthUser } from "./user-auth.js";

export interface StoredUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  tokenVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  role?: "admin" | "user";
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  password?: string;
  role?: "admin" | "user";
}

let migrated = false;

function ensureTable(): void {
  if (migrated) return;

  const db = getSessionStorageDatabase();
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
  `);

  // Migration: add token_version column if missing (existing databases)
  try {
    db.sqlite.prepare("SELECT token_version FROM auth_users LIMIT 1").get();
  } catch {
    db.sqlite.exec("ALTER TABLE auth_users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
  }

  migrated = true;
}

function rowToStoredUser(row: Record<string, unknown>): StoredUser {
  return {
    id: row.id as string,
    email: row.email as string,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    role: (row.role as "admin" | "user") ?? "user",
    tokenVersion: (row.token_version as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toAuthUser(stored: StoredUser): AuthUser {
  return {
    id: stored.id,
    email: stored.email,
    username: stored.username,
    role: stored.role,
  };
}

export function getUserCount(): number {
  ensureTable();
  const db = getSessionStorageDatabase();
  const row = db.sqlite.prepare("SELECT COUNT(*) as count FROM auth_users").get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getUserByEmail(email: string): StoredUser | null {
  ensureTable();
  const db = getSessionStorageDatabase();
  const row = db.sqlite.prepare("SELECT * FROM auth_users WHERE email = ?").get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
  return row ? rowToStoredUser(row) : null;
}

export function getUserById(id: string): StoredUser | null {
  ensureTable();
  const db = getSessionStorageDatabase();
  const row = db.sqlite.prepare("SELECT * FROM auth_users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToStoredUser(row) : null;
}

export async function createUser(input: CreateUserInput): Promise<StoredUser> {
  ensureTable();
  const db = getSessionStorageDatabase();

  const email = input.email.toLowerCase().trim();
  const existing = getUserByEmail(email);
  if (existing) {
    throw new Error("User with this email already exists");
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();

  // First user becomes admin automatically
  const userCount = getUserCount();
  const role = input.role ?? (userCount === 0 ? "admin" : "user");

  db.sqlite.prepare(
    "INSERT INTO auth_users (id, email, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, email, input.username.trim(), passwordHash, role, now, now);

  return {
    id,
    email,
    username: input.username.trim(),
    passwordHash,
    role,
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<StoredUser | null> {
  ensureTable();
  const db = getSessionStorageDatabase();

  const current = getUserById(id);
  if (!current) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.email !== undefined) {
    const email = input.email.toLowerCase().trim();
    const existingWithEmail = getUserByEmail(email);
    if (existingWithEmail && existingWithEmail.id !== id) {
      throw new Error("Email already in use by another user");
    }
    updates.push("email = ?");
    values.push(email);
  }

  if (input.username !== undefined) {
    updates.push("username = ?");
    values.push(input.username.trim());
  }

  if (input.password !== undefined) {
    const passwordHash = await hashPassword(input.password);
    updates.push("password_hash = ?");
    values.push(passwordHash);
  }

  if (input.role !== undefined) {
    updates.push("role = ?");
    values.push(input.role);
  }

  if (updates.length === 0) return current;

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  db.sqlite.prepare(`UPDATE auth_users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  return getUserById(id);
}

/**
 * Increment token_version for a user, invalidating all existing refresh tokens.
 */
export function incrementTokenVersion(userId: string): void {
  ensureTable();
  const db = getSessionStorageDatabase();
  db.sqlite.prepare(
    "UPDATE auth_users SET token_version = token_version + 1, updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), userId);
}

export function listUsers(): AuthUser[] {
  ensureTable();
  const db = getSessionStorageDatabase();
  const rows = db.sqlite.prepare("SELECT * FROM auth_users ORDER BY created_at ASC").all() as Record<string, unknown>[];
  return rows.map((row) => toAuthUser(rowToStoredUser(row)));
}

export function deleteUser(id: string): boolean {
  ensureTable();
  const db = getSessionStorageDatabase();
  const result = db.sqlite.prepare("DELETE FROM auth_users WHERE id = ?").run(id);
  return (result.changes ?? 0) > 0;
}

export { toAuthUser };
