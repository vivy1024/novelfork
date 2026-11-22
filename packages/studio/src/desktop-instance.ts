import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * 桌面单实例：同一个 NovelFork 数据目录（同一个 Runtime 目录）只跑一个进程。
 *
 * 再次双击 EXE 时，新进程在加载 Runtime 之前读这里的实例记录：记录里的进程还活着、
 * 地址上答的确实是它（`/api/health` 正常或仍在启动状态页），就把窗口交给它，自己退出码 0 退出。
 *
 * 记录 `<Runtime 目录>/novelfork-desktop.json` 只由 NovelFork 写：
 * - 进程一开始就以独占创建（`wx`）认领，此时还没有地址（`url: null`）；
 * - 启动状态页可访问、真服务监听后各更新一次地址；
 * - 正常退出时删除（只删自己的）。
 * 记录只有 NovelFork 会写，所以“记录 pid == 存活进程且地址答 Runtime 健康检查”即证明对方是 NovelFork。
 * Runtime 实例锁（`narrafork.lock`）只做一致性校验：锁被另一个存活进程持有时不信任记录。
 *
 * 陈旧记录（进程已退出、长时间没有地址、地址不再应答）一律按“没有实例”处理并接管，
 * 之后交给 Runtime 原有的实例锁逻辑决定能否启动。
 */

export const DESKTOP_INSTANCE_FILE = "novelfork-desktop.json";
/** Runtime 实例锁文件名（`server/lib/instance-lock.ts` 写在 NARRAFORK_HOME 下）。 */
export const RUNTIME_INSTANCE_LOCK_FILE = "narrafork.lock";
/** 认领后迟迟没有地址的记录视为陈旧：正常启动在几秒内就会写入状态页地址。 */
export const UNADDRESSED_RECORD_STALE_MS = 60_000;
/** Runtime 启动状态页每个响应都带这个头（`shared/startup-status.ts` 的 STARTUP_STATUS_HEADER）。 */
export const RUNTIME_STARTING_HEADER = "x-narrafork-starting";

export interface DesktopInstanceRecord {
  readonly product: "NovelFork";
  readonly pid: number;
  /** 浏览器可打开的地址；认领后、状态页可访问前为 null。 */
  readonly url: string | null;
  /** 窗口标题（实例显示名），用于聚焦已开的窗口。 */
  readonly windowTitle?: string;
  readonly updatedAt: string;
}

export type RunningDesktopInstance = {
  readonly kind: "running";
  readonly pid: number;
  readonly url: string;
  /** 对方仍在启动：地址上答的是启动状态页。 */
  readonly starting: boolean;
  readonly windowTitle?: string;
};

export type DesktopInstanceProbe =
  | RunningDesktopInstance
  | {
      readonly kind: "none";
      readonly reason:
        | "no-record"
        | "own-record"
        | "process-gone"
        | "lock-held-by-other"
        | "unaddressed"
        | "stale-unaddressed"
        | "unreachable"
        | "not-runtime";
    };

export interface DesktopInstanceDeps {
  readonly readText?: (path: string) => string | undefined;
  readonly isAlive?: (pid: number) => boolean;
  readonly fetch?: (url: string, init: { signal: AbortSignal }) => Promise<HealthResponseLike>;
  readonly now?: () => number;
  readonly healthTimeoutMs?: number;
}

export interface HealthResponseLike {
  readonly status: number;
  readonly headers: { has(name: string): boolean };
  json(): Promise<unknown>;
}

export function desktopInstanceRecordPath(runtimeDir: string): string {
  return join(runtimeDir, DESKTOP_INSTANCE_FILE);
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** 进程是否存活。`kill(pid, 0)` 不发信号；EPERM 表示进程存在但无权限。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function parseDesktopInstanceRecord(text: string | undefined): DesktopInstanceRecord | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<DesktopInstanceRecord>;
    if (value.product !== "NovelFork") return undefined;
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) return undefined;
    if (value.url !== null && typeof value.url !== "string") return undefined;
    if (typeof value.updatedAt !== "string") return undefined;
    return {
      product: "NovelFork",
      pid: value.pid,
      url: value.url,
      updatedAt: value.updatedAt,
      ...(typeof value.windowTitle === "string" && value.windowTitle.trim()
        ? { windowTitle: value.windowTitle.trim() }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/** Runtime 实例锁里记录的持有者 pid；锁不存在或读不懂时为 undefined。 */
export function parseRuntimeLockHolderPid(text: string | undefined): number | undefined {
  if (!text) return undefined;
  try {
    const pid = (JSON.parse(text) as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runtime 的健康应答：真服务（200，带 version / runtimeEnvironment，同 Runtime `isNarraForkHealth`），
 * 或启动状态页（503 且带启动头）。其他程序占着这个端口时两者都不满足。
 */
export function classifyRuntimeHealth(
  status: number,
  hasStartingHeader: boolean,
  body: unknown,
): "ready" | "starting" | "other" {
  if (hasStartingHeader && status === 503) return "starting";
  if (status !== 200 || !body || typeof body !== "object") return "other";
  const health = body as Record<string, unknown>;
  const ready =
    typeof health.version === "string" &&
    typeof health.gitAvailable === "boolean" &&
    ["windows", "macos", "linux"].includes(health.platform as string) &&
    !!health.runtimeEnvironment &&
    typeof health.runtimeEnvironment === "object";
  return ready ? "ready" : "other";
}

async function defaultFetch(url: string, init: { signal: AbortSignal }): Promise<HealthResponseLike> {
  // 直连本机：不走环境代理（Bun 的 fetch 认 `proxy: false`；Node 忽略这个字段）。
  return fetch(url, { ...init, cache: "no-store", proxy: false } as RequestInit);
}

/**
 * 判断同一数据目录是否已有 NovelFork 在跑。只读，不改任何文件。
 */
export async function probeRunningDesktopInstance(
  runtimeDir: string,
  selfPid: number,
  deps: DesktopInstanceDeps = {},
): Promise<DesktopInstanceProbe> {
  const readText = deps.readText ?? readTextFile;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const now = deps.now ?? Date.now;

  const record = parseDesktopInstanceRecord(readText(desktopInstanceRecordPath(runtimeDir)));
  if (!record) return { kind: "none", reason: "no-record" };
  if (record.pid === selfPid) return { kind: "none", reason: "own-record" };
  if (!isAlive(record.pid)) return { kind: "none", reason: "process-gone" };

  const lockPid = parseRuntimeLockHolderPid(readText(join(runtimeDir, RUNTIME_INSTANCE_LOCK_FILE)));
  if (lockPid !== undefined && lockPid !== record.pid && lockPid !== selfPid && isAlive(lockPid)) {
    return { kind: "none", reason: "lock-held-by-other" };
  }

  if (!record.url) {
    const age = now() - Date.parse(record.updatedAt);
    return {
      kind: "none",
      reason: Number.isFinite(age) && age > UNADDRESSED_RECORD_STALE_MS ? "stale-unaddressed" : "unaddressed",
    };
  }

  let health: "ready" | "starting" | "other";
  try {
    const response = await (deps.fetch ?? defaultFetch)(new URL("/api/health", record.url).href, {
      signal: AbortSignal.timeout(deps.healthTimeoutMs ?? 2_000),
    });
    const hasStartingHeader = response.headers.has(RUNTIME_STARTING_HEADER);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    health = classifyRuntimeHealth(response.status, hasStartingHeader, body);
  } catch {
    return { kind: "none", reason: "unreachable" };
  }
  if (health === "other") return { kind: "none", reason: "not-runtime" };
  return {
    kind: "running",
    pid: record.pid,
    url: record.url,
    starting: health === "starting",
    ...(record.windowTitle ? { windowTitle: record.windowTitle } : {}),
  };
}

/**
 * 等对方写出地址再判断：刚双击两次时，前一个进程已认领但状态页还没起来。
 * 只在“认领了、还没地址”时继续等，其他结论立即返回。
 */
export async function waitForRunningDesktopInstance(
  runtimeDir: string,
  selfPid: number,
  options: DesktopInstanceDeps & { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<DesktopInstanceProbe> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 15_000);
  for (;;) {
    const probe = await probeRunningDesktopInstance(runtimeDir, selfPid, options);
    if (probe.kind === "running" || probe.reason !== "unaddressed" || now() >= deadline) return probe;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 250));
  }
}

function recordText(record: DesktopInstanceRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export interface ClaimOptions {
  readonly windowTitle?: string;
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => number;
  /** 已判定现有记录不可信（进程活着但地址不答等）：直接覆盖。 */
  readonly force?: boolean;
}

/**
 * 认领实例记录。已有一个“活着的他人记录”时返回 false（两个进程同时认领，输的一方重新判断）；
 * 陈旧记录被替换。认领失败（目录不可写等）不阻止启动，返回 true 交给 Runtime 实例锁兜底。
 */
export function claimDesktopInstanceRecord(
  runtimeDir: string,
  selfPid: number,
  options: ClaimOptions = {},
): boolean {
  const path = desktopInstanceRecordPath(runtimeDir);
  const isAlive = options.isAlive ?? isProcessAlive;
  const record: DesktopInstanceRecord = {
    product: "NovelFork",
    pid: selfPid,
    url: null,
    ...(options.windowTitle ? { windowTitle: options.windowTitle } : {}),
    updatedAt: new Date((options.now ?? Date.now)()).toISOString(),
  };
  if (options.force) {
    writeRecordAtomically(path, selfPid, record);
    return true;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, recordText(record));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return true;
    }
    const existing = parseDesktopInstanceRecord(readTextFile(path));
    if (existing && existing.pid !== selfPid && isAlive(existing.pid)) return false;
    // 陈旧或读不懂的记录：移走后再独占创建一次。
    try {
      rmSync(path, { force: true });
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * 更新自己记录里的地址（原子替换）。记录已被他人接管时不动它。
 */
export function updateDesktopInstanceRecord(
  runtimeDir: string,
  selfPid: number,
  update: { readonly url: string; readonly windowTitle?: string },
  now: () => number = Date.now,
): boolean {
  const path = desktopInstanceRecordPath(runtimeDir);
  const existing = parseDesktopInstanceRecord(readTextFile(path));
  if (existing && existing.pid !== selfPid) return false;
  const record: DesktopInstanceRecord = {
    product: "NovelFork",
    pid: selfPid,
    url: update.url,
    ...((update.windowTitle ?? existing?.windowTitle)
      ? { windowTitle: update.windowTitle ?? existing?.windowTitle }
      : {}),
    updatedAt: new Date(now()).toISOString(),
  };
  return writeRecordAtomically(path, selfPid, record);
}

function writeRecordAtomically(path: string, selfPid: number, record: DesktopInstanceRecord): boolean {
  const temporary = `${path}.${selfPid}.tmp`;
  try {
    writeFileSync(temporary, recordText(record));
    renameSync(temporary, path);
    return true;
  } catch {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // 尽力清理
    }
    return false;
  }
}

/** 这些结论说明没有别的进程在用记录，可以正常独占认领；其余是“进程活着但记录不可信”。 */
const UNCONTESTED_REASONS = new Set(["no-record", "own-record", "process-gone"]);

/**
 * 启动入口用：已有可用实例则返回它（调用方把窗口交给它并退出），否则认领记录返回 claimed。
 * 两个进程同时认领时输的一方再判断一次（此时赢的一方的记录已在，等它写出地址）。
 */
export async function resolveDesktopInstance(
  runtimeDir: string,
  selfPid: number,
  options: DesktopInstanceDeps & {
    readonly windowTitle?: string;
    readonly waitTimeoutMs?: number;
    readonly intervalMs?: number;
  } = {},
): Promise<RunningDesktopInstance | { readonly kind: "claimed" }> {
  for (let round = 0; round < 2; round++) {
    const probe = await waitForRunningDesktopInstance(runtimeDir, selfPid, {
      ...options,
      timeoutMs: options.waitTimeoutMs,
    });
    if (probe.kind === "running") return probe;
    const claimed = claimDesktopInstanceRecord(runtimeDir, selfPid, {
      windowTitle: options.windowTitle,
      isAlive: options.isAlive,
      now: options.now,
      force: !UNCONTESTED_REASONS.has(probe.reason),
    });
    if (claimed) return { kind: "claimed" };
  }
  // 仍判断不出来：不写记录，交给 Runtime 实例锁裁决。
  return { kind: "claimed" };
}

/** 退出时删除自己的记录；他人的记录不动。 */
export function releaseDesktopInstanceRecord(runtimeDir: string, selfPid: number): void {
  const path = desktopInstanceRecordPath(runtimeDir);
  const existing = parseDesktopInstanceRecord(readTextFile(path));
  if (!existing || existing.pid !== selfPid) return;
  try {
    rmSync(path, { force: true });
  } catch {
    // 下次启动按陈旧记录接管
  }
}
