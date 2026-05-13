/**
 * Incremental Update — generate binary patches for efficient updates.
 *
 * 对标 NarraFork v0.1.0: zstd patch-from 增量更新，更新包缩小 99%
 *
 * Strategy:
 * 1. Keep the previous release binary as a reference
 * 2. Generate a binary diff (patch) between old and new
 * 3. Client downloads only the patch and applies it locally
 *
 * This module provides the patch generation logic.
 * The actual zstd --patch-from requires the zstd CLI tool.
 */

import { execSync, execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PatchResult {
  ok: boolean;
  patchPath?: string;
  originalSize?: number;
  patchSize?: number;
  compressionRatio?: number;
  error?: string;
}

/**
 * Check if zstd CLI is available.
 */
export function isZstdAvailable(): boolean {
  try {
    execSync("zstd --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate an incremental patch using zstd --patch-from.
 *
 * @param oldFile - Path to the previous version binary
 * @param newFile - Path to the new version binary
 * @param outputDir - Directory to write the patch file
 * @returns PatchResult with patch path and compression stats
 */
export async function generatePatch(oldFile: string, newFile: string, outputDir: string): Promise<PatchResult> {
  if (!existsSync(oldFile)) {
    return { ok: false, error: `Old file not found: ${oldFile}` };
  }
  if (!existsSync(newFile)) {
    return { ok: false, error: `New file not found: ${newFile}` };
  }

  if (!isZstdAvailable()) {
    return { ok: false, error: "zstd CLI not found. Install zstd to enable incremental updates." };
  }

  const patchName = `${basename(newFile)}.patch.zst`;
  const patchPath = resolve(outputDir, patchName);

  try {
    await execFileAsync("zstd", ["--patch-from", oldFile, newFile, "-o", patchPath, "--ultra", "-22"], {
      timeout: 120000,
    });

    const originalSize = statSync(newFile).size;
    const patchSize = statSync(patchPath).size;
    const compressionRatio = patchSize > 0 ? Math.round((1 - patchSize / originalSize) * 100) : 0;

    return {
      ok: true,
      patchPath,
      originalSize,
      patchSize,
      compressionRatio,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Patch generation failed",
    };
  }
}

/**
 * Apply a patch to reconstruct the new file from old + patch.
 *
 * @param oldFile - Path to the previous version binary
 * @param patchFile - Path to the patch file
 * @param outputFile - Path to write the reconstructed new binary
 */
export async function applyPatch(oldFile: string, patchFile: string, outputFile: string): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(oldFile)) {
    return { ok: false, error: `Old file not found: ${oldFile}` };
  }
  if (!existsSync(patchFile)) {
    return { ok: false, error: `Patch file not found: ${patchFile}` };
  }

  if (!isZstdAvailable()) {
    return { ok: false, error: "zstd CLI not found." };
  }

  try {
    await execFileAsync("zstd", ["-d", "--patch-from", oldFile, patchFile, "-o", outputFile], {
      timeout: 120000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Patch application failed" };
  }
}
