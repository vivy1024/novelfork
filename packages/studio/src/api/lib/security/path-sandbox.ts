/**
 * Path Sandbox — validates file paths to prevent directory traversal attacks.
 *
 * Ensures tool operations (Read, Write, Edit, Glob, Grep) cannot
 * escape the configured working directory boundary.
 */

import { resolve, normalize, sep } from "node:path";

export interface PathSandboxConfig {
  /** The root working directory boundary */
  workDir: string;
  /** Additional allowed directories (e.g., temp dirs, system paths) */
  allowedPaths?: string[];
}

/**
 * Normalize and resolve a path, then check if it's within the sandbox boundary.
 * Returns the resolved absolute path if valid, or null if the path escapes the sandbox.
 */
export function validatePath(filePath: string, config: PathSandboxConfig): { valid: true; resolvedPath: string } | { valid: false; reason: string } {
  // Normalize the working directory
  const normalizedWorkDir = normalize(resolve(config.workDir));

  // Resolve the target path (handles ../ traversal)
  const resolvedPath = normalize(resolve(normalizedWorkDir, filePath));

  // Check if within workDir (ensure boundary ends with separator to prevent prefix collision)
  const boundary = normalizedWorkDir.endsWith(sep) ? normalizedWorkDir : normalizedWorkDir + sep;
  if (resolvedPath === normalizedWorkDir || resolvedPath.startsWith(boundary)) {
    return { valid: true, resolvedPath };
  }

  // Check additional allowed paths
  if (config.allowedPaths) {
    for (const allowed of config.allowedPaths) {
      const normalizedAllowed = normalize(resolve(allowed));
      const allowedBoundary = normalizedAllowed.endsWith(sep) ? normalizedAllowed : normalizedAllowed + sep;
      if (resolvedPath === normalizedAllowed || resolvedPath.startsWith(allowedBoundary)) {
        return { valid: true, resolvedPath };
      }
    }
  }

  return {
    valid: false,
    reason: `Path "${filePath}" resolves to "${resolvedPath}" which is outside the allowed boundary "${normalizedWorkDir}"`,
  };
}

/**
 * Check if a path contains suspicious traversal patterns (quick pre-check).
 * Doesn't replace validatePath() — use both for defense-in-depth.
 */
export function hasSuspiciousTraversal(filePath: string): boolean {
  // Null bytes (path injection)
  if (filePath.includes('\0')) return true;
  // Explicit parent traversal outside start
  if (/\.\.[\/\\]/.test(filePath) && !filePath.startsWith('.')) return true;
  // Windows UNC paths that could reach network shares
  if (/^\\\\[^.]/.test(filePath)) return true;
  // Absolute paths starting with drive letter or root (when expecting relative)
  // This is an indicator only — validatePath does the real check
  return false;
}

/**
 * Create a sandbox validator bound to a specific working directory.
 * Returns a function that validates paths relative to that workDir.
 */
export function createPathSandbox(workDir: string, allowedPaths?: string[]) {
  const config: PathSandboxConfig = { workDir, allowedPaths };
  return {
    validate: (filePath: string) => validatePath(filePath, config),
    hasSuspicious: hasSuspiciousTraversal,
    workDir: normalize(resolve(workDir)),
  };
}
