import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

import { STYLE_DISTILLATIONS_RELATIVE_DIR } from "./style-distillation.js";

/**
 * 文风蒸馏任务的跨进程运行锁：同一任务同一时刻只允许一个执行者。
 *
 * 口径沿用 core 书籍写锁（StateManager.acquireBookLock）：锁文件用 `wx` 原子创建，内容记
 * 进程号 / 主机名 / 心跳时间 / 令牌；判断锁是否还活着：
 * - 另一台主机的锁：本机无法判断那边的进程是否还在，一律视为被占用（书放在共享盘时不抢）；
 * - 本机、进程已不存在：陈旧，可回收；
 * - 本机、就是本进程但内存里没有这把令牌：释放失败的残留或 pid 复用，陈旧；
 * - 本机、进程还在但心跳超过 STYLE_DISTILLATION_LOCK_STALE_MS：按 pid 被复用处理，陈旧。
 * 回收用「改名认领 → 核对内容 → 删除」，避免两个回收者互删对方刚建的新锁。
 * 运行者每开始一批就刷新心跳，长任务不会因为总时长被误判陈旧。
 */

/** 心跳超过这个时长视为陈旧：单批模型调用远小于它，留足慢模型与重试的余量。 */
export const STYLE_DISTILLATION_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

const heldTokens = new Set<string>();

interface LockRecord {
  readonly pid?: number;
  readonly host?: string;
  readonly ts?: number;
  readonly token?: string;
}

export type StyleDistillationLockOwner =
  | { readonly kind: "none" }
  | { readonly kind: "self" }
  | { readonly kind: "other-process"; readonly pid: number; readonly since?: number }
  | { readonly kind: "other-host"; readonly host: string; readonly pid?: number };

export interface StyleDistillationLockHandle {
  /** 刷新心跳；锁已被别人接管时返回 false（调用方应停止写任务文件）。 */
  readonly heartbeat: () => Promise<boolean>;
  readonly release: () => Promise<void>;
}

export function styleDistillationLockPath(bookRoot: string, jobId: string): string {
  return join(resolve(bookRoot), STYLE_DISTILLATIONS_RELATIVE_DIR, `${jobId}.run.lock`);
}

function format(record: Required<LockRecord>): string {
  return `pid:${record.pid} ts:${record.ts} host:${encodeURIComponent(record.host)} token:${record.token}`;
}

function parse(raw: string): LockRecord {
  const field = (name: string) => raw.match(new RegExp(`(?:^|\\s)${name}:(\\S+)`, "u"))?.[1];
  const int = (value: string | undefined) => value && /^\d+$/u.test(value) ? Number(value) : undefined;
  const hostField = field("host");
  let host: string | undefined;
  if (hostField) {
    try { host = decodeURIComponent(hostField); } catch { host = hostField; }
  }
  return { pid: int(field("pid")), ts: int(field("ts")), host, token: field("token") };
}

function sameHost(value: string): boolean {
  return value.trim().toLowerCase() === hostname().trim().toLowerCase();
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code !== "ESRCH";
  }
}

type Verdict =
  | { readonly kind: "gone" }
  | { readonly kind: "stale"; readonly raw: string }
  | { readonly kind: "held"; readonly owner: Exclude<StyleDistillationLockOwner, { kind: "none" }> };

async function judge(path: string): Promise<Verdict> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "gone" };
    // 读不了就看不清归属：宁可当作被占用，也不冒险并发执行。
    return { kind: "held", owner: { kind: "other-process", pid: 0 } };
  }
  const record = parse(raw);
  if (record.pid === undefined) {
    // 刚建好、内容还没写完的锁：给一小段宽限，超时按陈旧回收。
    const mtime = await stat(path).then((info) => info.mtimeMs).catch(() => undefined);
    if (mtime === undefined) return { kind: "gone" };
    return Date.now() - mtime > 10_000 ? { kind: "stale", raw } : { kind: "held", owner: { kind: "other-process", pid: 0 } };
  }
  if (record.host !== undefined && !sameHost(record.host)) {
    return { kind: "held", owner: { kind: "other-host", host: record.host, pid: record.pid } };
  }
  if (record.pid === process.pid) {
    return record.token !== undefined && heldTokens.has(record.token)
      ? { kind: "held", owner: { kind: "self" } }
      : { kind: "stale", raw };
  }
  if (!processAlive(record.pid)) return { kind: "stale", raw };
  if (record.ts !== undefined && Date.now() - record.ts > STYLE_DISTILLATION_LOCK_STALE_MS) return { kind: "stale", raw };
  return { kind: "held", owner: { kind: "other-process", pid: record.pid, ...(record.ts ? { since: record.ts } : {}) } };
}

async function reclaim(path: string, staleRaw: string): Promise<void> {
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current !== staleRaw) return;
  const claim = join(dirname(path), `.reclaim-${randomUUID()}.lock`);
  try {
    await rename(path, claim);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const claimed = await readFile(claim, "utf8").catch(() => undefined);
  if (claimed !== undefined && claimed !== staleRaw) {
    // 改名时带走的是别人刚建的新锁：原样放回（锁位已被第三方占用就不覆盖）。
    const handle = await open(path, "wx").catch(() => null);
    if (handle) {
      try { await handle.writeFile(claimed, "utf8"); } finally { await handle.close().catch(() => undefined); }
    }
  }
  await unlink(claim).catch(() => undefined);
}

/** 查看任务当前由谁执行；不获取、不回收。陈旧锁按「无人」返回。 */
export async function inspectStyleDistillationLock(bookRoot: string, jobId: string): Promise<StyleDistillationLockOwner> {
  const verdict = await judge(styleDistillationLockPath(bookRoot, jobId));
  return verdict.kind === "held" ? verdict.owner : { kind: "none" };
}

/**
 * 获取任务运行锁。锁被活着的执行者持有时返回其归属，不排队、不等待。
 */
export async function acquireStyleDistillationLock(
  bookRoot: string,
  jobId: string,
): Promise<{ readonly ok: true; readonly handle: StyleDistillationLockHandle } | { readonly ok: false; readonly owner: Exclude<StyleDistillationLockOwner, { kind: "none" }> }> {
  const path = styleDistillationLockPath(bookRoot, jobId);
  await mkdir(dirname(path), { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    heldTokens.add(token);
    let handle;
    try {
      handle = await open(path, "wx");
    } catch (error) {
      heldTokens.delete(token);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const verdict = await judge(path);
      if (verdict.kind === "held") return { ok: false, owner: verdict.owner };
      if (verdict.kind === "stale") {
        console.warn(`[style-distillations] 回收任务 ${jobId} 的陈旧运行锁：${verdict.raw.trim()}`);
        await reclaim(path, verdict.raw);
      }
      continue;
    }
    try {
      await handle.writeFile(format({ pid: process.pid, host: hostname(), ts: Date.now(), token }), "utf8");
    } catch (error) {
      // 锁文件已建出却没写进内容：令牌不能留在内存里（否则「内存里没有这把令牌即陈旧」的判断永远不成立），
      // 半截空锁文件也删掉，别让下一位等 10 秒陈旧回收。
      heldTokens.delete(token);
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw error;
    }
    await handle.close().catch(() => undefined);
    return { ok: true, handle: createHandle(path, token) };
  }
  return { ok: false, owner: { kind: "other-process", pid: 0 } };
}

function createHandle(path: string, token: string): StyleDistillationLockHandle {
  let released = false;
  const ownsLock = async () => {
    const raw = await readFile(path, "utf8").catch(() => undefined);
    return raw !== undefined && parse(raw).token === token;
  };
  return {
    heartbeat: async () => {
      if (released || !(await ownsLock())) return false;
      await writeFile(path, format({ pid: process.pid, host: hostname(), ts: Date.now(), token }), "utf8");
      return true;
    },
    release: async () => {
      if (released) return;
      released = true;
      try {
        if (await ownsLock()) await unlink(path).catch(() => undefined);
      } finally {
        heldTokens.delete(token);
      }
    },
  };
}
