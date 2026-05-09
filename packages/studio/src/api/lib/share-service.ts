import { randomBytes } from "node:crypto";
import { basename, resolve } from "node:path";

interface ShareEntry {
  token: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  expiresAt: number;
  createdAt: number;
}

const shares = new Map<string, ShareEntry>();

export function createShareLink(filePath: string, expiresInMs = 24 * 60 * 60 * 1000): { token: string; url: string; expiresAt: number } {
  const token = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + expiresInMs;
  const fileName = basename(filePath);
  shares.set(token, { token, filePath: resolve(filePath), fileName, mimeType: guessMimeType(fileName), expiresAt, createdAt: Date.now() });
  return { token, url: `/api/share/${token}`, expiresAt };
}

export function getShareEntry(token: string): ShareEntry | null {
  const entry = shares.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { shares.delete(token); return null; }
  return entry;
}

export function deleteShareEntry(token: string): boolean {
  return shares.delete(token);
}

export function pruneExpiredShares(): number {
  let pruned = 0;
  const now = Date.now();
  for (const [token, entry] of shares) {
    if (now > entry.expiresAt) { shares.delete(token); pruned++; }
  }
  return pruned;
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", zip: "application/zip", tar: "application/x-tar", gz: "application/gzip" };
  return map[ext ?? ""] ?? "application/octet-stream";
}
