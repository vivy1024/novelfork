/**
 * 第三方 apiKey 的本地加密（T-10）。
 *
 * 密钥写入 kv_store 前用本机主密钥做 AES-256-GCM 加密；主密钥是 NOVELFORK_HOME 下的
 * 一个 32 字节随机文件（`.secret-key`），不进仓库、不进 kv_store。
 *
 * - 旧版明文兼容：kv 里读到字符串时视为升级前保存的明文 key，原样返回，使已填写的 key
 *   不因升级而失效；调用方下一次保存配置时一律以密文写回（向量模型保存时会沿用并重新加密
 *   旧 key；朱雀保存要求重新提交 key），明文从此不再落库。
 * - 认证标签长度固定 16 字节：解密时显式指定 authTagLength，拒绝被截短的标签
 *   （GCM 接受最短 4 字节标签，等于把伪造难度降到 2^32）。
 * - 主密钥文件损坏（长度不是 32 字节）时抛出带 explanation 的 SecretKeyFileError，
 *   绝不静默生成新密钥覆盖：覆盖后所有旧密文都将永远解不开。
 * - 文件权限：写入时请求 0o600，只在 POSIX 上生效；Windows 忽略该模式，文件继承所在目录的
 *   ACL（通常是用户主目录，仅本人与管理员可读）。这里不调用 icacls 改 ACL，保护强度以
 *   NOVELFORK_HOME 所在目录的权限为准。
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const KEY_FILE_NAME = ".secret-key";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;

export interface SecretKeyFileExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

/** 主密钥文件不可用（长度不对）。不自动修复，交给作者决定，见 explanation。 */
export class SecretKeyFileError extends Error {
  readonly code = "SECRET_KEY_FILE_CORRUPT";
  readonly explanation: SecretKeyFileExplanation;

  constructor(path: string, actualBytes: number) {
    super(`secret-box: 主密钥文件长度不正确（${actualBytes} 字节，应为 ${MASTER_KEY_BYTES} 字节），已拒绝使用。`);
    this.name = "SecretKeyFileError";
    this.explanation = {
      whatHappened: `NovelFork 数据目录里的主密钥文件 ${path} 长度为 ${actualBytes} 字节，不是应有的 ${MASTER_KEY_BYTES} 字节，已拒绝使用，也没有改动它。`,
      whyItMatters: "已保存的朱雀检测与向量模型密钥都用这把主密钥加密；若自动换成新密钥，旧密文将永远无法解开，这些配置会全部失效。",
      suggestedAction: "若有该文件的备份，请恢复后重启；确认无法恢复时，删除该文件并重新填写朱雀检测与向量模型的 API Key（系统会生成新的主密钥）。",
    };
  }
}

export interface SealedSecret {
  readonly enc: "v1";
  readonly iv: string;
  readonly tag: string;
  readonly ct: string;
}

function configDir(): string {
  const fromEnv = process.env.NOVELFORK_HOME?.trim();
  return fromEnv ? resolve(fromEnv) : join(homedir(), ".novelfork");
}

/**
 * 把任意字节复制进一块明确的 ArrayBuffer。Buffer 在当前 @types/node 下与
 * Node 的加解密、文件 API 的泛型不兼容，统一经由这里转换，只保留一处类型边界。
 */
function toBytes(source: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(source.length));
  out.set(source);
  return out;
}

function concatBytes(parts: ReadonlyArray<ArrayLike<number>>): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const keyCache = new Map<string, Uint8Array<ArrayBuffer>>();

const KEY_READ_ATTEMPTS = 20;
const KEY_READ_WAIT_MS = 25;

/**
 * 读取已存在的主密钥。另一个并发调用可能刚创建文件、还没写完，此时读到的是空或半截内容；
 * 短暂等待后重读，只有多次重试后仍不是 32 字节才判定为真正损坏。
 */
async function readExistingKey(path: string): Promise<Uint8Array<ArrayBuffer>> {
  let lastLength = 0;
  for (let attempt = 0; attempt < KEY_READ_ATTEMPTS; attempt += 1) {
    const bytes = toBytes(await readFile(path));
    if (bytes.length === MASTER_KEY_BYTES) return bytes;
    lastLength = bytes.length;
    await new Promise((resolve) => setTimeout(resolve, KEY_READ_WAIT_MS));
  }
  throw new SecretKeyFileError(path, lastLength);
}

/** 读取或首次生成主密钥。按目录缓存，切换 NOVELFORK_HOME 时不会串用别处的密钥。 */
async function masterKey(): Promise<Uint8Array<ArrayBuffer>> {
  const dir = configDir();
  const cached = keyCache.get(dir);
  if (cached) return cached;
  const path = join(dir, KEY_FILE_NAME);
  if (existsSync(path)) {
    const existing = await readExistingKey(path);
    keyCache.set(dir, existing);
    return existing;
  }
  await mkdir(dir, { recursive: true });
  const fresh = toBytes(randomBytes(MASTER_KEY_BYTES));
  try {
    // wx：文件已存在时失败而不是覆盖（并发创建或损坏文件都不会被新密钥顶掉）。
    // mode 0o600 只在 POSIX 生效，Windows 上由目录 ACL 决定可见范围（见文件头注释）。
    await writeFile(path, fresh, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // 另一个并发调用已先创建了密钥：改为读取它，而不是让本次保存失败。
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const created = await readExistingKey(path);
    keyCache.set(dir, created);
    return created;
  }
  keyCache.set(dir, fresh);
  return fresh;
}

export function isEncryptedSecret(value: unknown): value is SealedSecret {
  return typeof value === "object"
    && value !== null
    && (value as { enc?: unknown }).enc === "v1"
    && typeof (value as { ct?: unknown }).ct === "string";
}

export async function encryptSecret(plaintext: string): Promise<SealedSecret> {
  const key = await masterKey();
  const iv = toBytes(randomBytes(IV_BYTES));
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ct = concatBytes([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    enc: "v1",
    iv: Buffer.from(iv).toString("base64"),
    tag: Buffer.from(toBytes(cipher.getAuthTag())).toString("base64"),
    ct: Buffer.from(ct).toString("base64"),
  };
}

/**
 * 解密。字符串视为旧版明文，原样返回（兼容升级前已保存的 key；下次保存时由调用方加密写回）。
 * 密文被篡改、认证标签被截短时抛错，而不是返回乱码或放行。
 */
export async function decryptSecret(value: unknown): Promise<string> {
  if (typeof value === "string") return value;
  if (!isEncryptedSecret(value)) throw new Error("secret-box: 无法识别的密钥格式。");
  const key = await masterKey();
  const decipher = createDecipheriv(ALGORITHM, key, toBytes(Buffer.from(value.iv, "base64")), { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(toBytes(Buffer.from(value.tag, "base64")));
  const pt = concatBytes([decipher.update(toBytes(Buffer.from(value.ct, "base64"))), decipher.final()]);
  return Buffer.from(pt).toString("utf8");
}
