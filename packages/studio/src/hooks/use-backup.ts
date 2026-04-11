/**
 * use-backup — encrypted backup/restore for workspace content (Tauri only).
 * Uses Web Crypto API (AES-GCM 256-bit) with PBKDF2 key derivation.
 */
import { useState, useEffect, useCallback } from "react";
import { useInkOS } from "../providers/inkos-context";

interface BackupEntry {
  readonly filename: string;
  readonly timestamp: number;
  readonly size: number;
}

interface BackupPayload {
  readonly version: 1;
  readonly createdAt: string;
  readonly books: ReadonlyArray<{
    readonly id: string;
    readonly config: Record<string, unknown>;
    readonly chapters: ReadonlyArray<{ readonly number: number; readonly content: string }>;
    readonly truthFiles: ReadonlyArray<{ readonly name: string; readonly content: string }>;
  }>;
}

interface UseBackupReturn {
  readonly createBackup: (passphrase: string) => Promise<void>;
  readonly restoreBackup: (filename: string, passphrase: string) => Promise<BackupPayload>;
  readonly backups: ReadonlyArray<BackupEntry>;
  readonly loading: boolean;
}

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(plaintext: string, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  // Layout: [salt (16)] [iv (12)] [ciphertext (...)]
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + cipherBuf.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(new Uint8Array(cipherBuf), SALT_LENGTH + IV_LENGTH);
  return result;
}

async function decrypt(data: Uint8Array, passphrase: string): Promise<string> {
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plainBuf);
}

// Tauri invoke helper (same pattern as tauri-adapter)
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await (Function('return import("@tauri-apps/api/core")')() as Promise<any>);
  return mod.invoke(cmd, args) as T;
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

async function collectBackupPayload(workspace: string): Promise<BackupPayload> {
  const bookIds = await invoke<string[]>("list_books", { workspace });
  const books: BackupPayload["books"][number][] = [];

  for (const id of bookIds) {
    try {
      const configPath = join(workspace, "books", id, "book.json");
      const configRaw = await invoke<string>("read_file_text", { path: configPath });
      const config = JSON.parse(configRaw) as Record<string, unknown>;

      // Collect chapters
      const chaptersDir = join(workspace, "books", id, "chapters");
      const chEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir }).catch(() => []);
      const chapters: Array<{ number: number; content: string }> = [];
      for (const e of chEntries) {
        if (e.is_dir || !e.name.endsWith(".md") || !/^\d{4}/.test(e.name)) continue;
        const num = parseInt(e.name.slice(0, 4), 10);
        const content = await invoke<string>("read_file_text", { path: join(chaptersDir, e.name) });
        chapters.push({ number: num, content });
      }

      // Collect truth files
      const storyDir = join(workspace, "books", id, "story");
      const storyEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: storyDir }).catch(() => []);
      const truthFiles: Array<{ name: string; content: string }> = [];
      for (const e of storyEntries) {
        if (e.is_dir) continue;
        try {
          const content = await invoke<string>("read_file_text", { path: join(storyDir, e.name) });
          truthFiles.push({ name: e.name, content });
        } catch { /* skip unreadable */ }
      }

      books.push({ id, config, chapters, truthFiles });
    } catch { /* skip broken books */ }
  }

  return { version: 1, createdAt: new Date().toISOString(), books };
}

async function listBackupFiles(workspace: string): Promise<ReadonlyArray<BackupEntry>> {
  const backupDir = join(workspace, ".inkos-backups");
  const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: backupDir }).catch(() => []);
  const results: BackupEntry[] = [];
  for (const e of entries) {
    if (e.is_dir || !e.name.endsWith(".bak")) continue;
    // filename format: {timestamp}.bak
    const ts = parseInt(e.name.replace(".bak", ""), 10);
    try {
      const content = await invoke<string>("read_file_text", { path: join(backupDir, e.name) });
      results.push({ filename: e.name, timestamp: ts, size: content.length });
    } catch { /* skip unreadable */ }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

export { type BackupEntry, type BackupPayload };

export function useBackup(): UseBackupReturn {
  const { mode, workspace } = useInkOS();
  const isTauri = mode === "tauri";
  const [backups, setBackups] = useState<ReadonlyArray<BackupEntry>>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri || !workspace) return;
    const list = await listBackupFiles(workspace);
    setBackups(list);
  }, [isTauri, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createBackup = useCallback(async (passphrase: string) => {
    if (!isTauri || !workspace) throw new Error("Backup not supported in browser mode");
    setLoading(true);
    try {
      const payload = await collectBackupPayload(workspace);
      const json = JSON.stringify(payload);
      const encrypted = await encrypt(json, passphrase);
      const backupDir = join(workspace, ".inkos-backups");
      await invoke("create_dir_all", { path: backupDir });
      const filename = `${Date.now()}.bak`;
      // Write as base64 text since Tauri invoke uses text files
      const b64 = btoa(String.fromCharCode(...encrypted));
      await invoke("write_file_text", { path: join(backupDir, filename), content: b64 });
      await refresh();
    } finally {
      setLoading(false);
    }
  }, [isTauri, workspace, refresh]);

  const restoreBackup = useCallback(async (filename: string, passphrase: string): Promise<BackupPayload> => {
    if (!isTauri || !workspace) throw new Error("Backup not supported in browser mode");
    setLoading(true);
    try {
      const backupDir = join(workspace, ".inkos-backups");
      const b64 = await invoke<string>("read_file_text", { path: join(backupDir, filename) });
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const json = await decrypt(raw, passphrase);
      return JSON.parse(json) as BackupPayload;
    } finally {
      setLoading(false);
    }
  }, [isTauri, workspace]);

  return { createBackup, restoreBackup, backups, loading };
}
