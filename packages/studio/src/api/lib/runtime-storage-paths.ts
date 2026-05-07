import { homedir } from "node:os";
import { join } from "node:path";

function resolveRuntimeDir(): string {
  const override = process.env.NOVELFORK_RUNTIME_DIR?.trim();
  return override || join(homedir(), ".novelfork");
}

export function resolveRuntimeStoragePath(...segments: string[]): string {
  return join(resolveRuntimeDir(), ...segments);
}

export function resolveRuntimeStorageDir(...segments: string[]): string {
  return resolveRuntimeStoragePath(...segments);
}
