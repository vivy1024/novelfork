import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * NovelFork 数据目录（产品全局配置、作者级技能、市场数据等的默认根）。
 * 设置 NOVELFORK_HOME 时以它为准，否则为 ~/.novelfork。LLM 的 <数据目录>/.env
 * 仍由 loadProjectConfig 读取；embedding 密钥不再走这里，而是落在产品库 kv_store。
 *
 * 路径必须懒计算：Studio 会经 core 根入口把本模块打进浏览器包。
 * 顶层 homedir()/join() 会在 Vite 构建期因 node 内置空壳硬崩。
 */
export function resolveGlobalConfigDir(): string {
  const fromEnv = typeof process !== "undefined" ? process.env?.NOVELFORK_HOME?.trim() : undefined;
  return fromEnv ? resolve(fromEnv) : join(homedir(), ".novelfork");
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
