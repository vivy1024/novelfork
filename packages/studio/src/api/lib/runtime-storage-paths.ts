import { homedir } from "node:os";
import { join } from "node:path";

const RUNTIME_DIR = join(homedir(), ".novelfork");

export function resolveRuntimeStoragePath(...segments: string[]): string {
  return join(RUNTIME_DIR, ...segments);
}

export function resolveRuntimeStorageDir(...segments: string[]): string {
  return resolveRuntimeStoragePath(...segments);
}
