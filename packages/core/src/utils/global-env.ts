import { homedir } from "node:os";
import { join } from "node:path";

/**
 * CLI 全局配置目录。LLM 的 ~/.novelfork/.env 仍由 loadProjectConfig 读取；
 * embedding 密钥不再走这里，而是落在产品库 kv_store。
 */
export const GLOBAL_CONFIG_DIR = join(homedir(), ".novelfork");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");

export function resolveGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR;
}

export function resolveGlobalEnvPath(): string {
  return GLOBAL_ENV_PATH;
}
