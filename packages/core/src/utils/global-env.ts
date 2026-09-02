import { homedir } from "node:os";
import { join } from "node:path";

/**
 * CLI 全局配置目录。LLM 的 ~/.novelfork/.env 仍由 loadProjectConfig 读取；
 * embedding 密钥不再走这里，而是落在产品库 kv_store。
 *
 * 路径必须懒计算：Studio 会经 core 根入口把本模块打进浏览器包。
 * 顶层 homedir()/join() 会在 Vite 构建期因 node 内置空壳硬崩。
 */
export function resolveGlobalConfigDir(): string {
  return join(homedir(), ".novelfork");
}

export function resolveGlobalEnvPath(): string {
  return join(resolveGlobalConfigDir(), ".env");
}

class LazyPath {
  constructor(private readonly resolve: () => string) {}
  toString(): string {
    return this.resolve();
  }
  valueOf(): string {
    return this.resolve();
  }
  [Symbol.toPrimitive](): string {
    return this.resolve();
  }
}

export const GLOBAL_CONFIG_DIR = new LazyPath(resolveGlobalConfigDir) as unknown as string;
export const GLOBAL_ENV_PATH = new LazyPath(resolveGlobalEnvPath) as unknown as string;
