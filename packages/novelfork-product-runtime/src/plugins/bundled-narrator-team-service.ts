/**
 * 内置 narrator-team 插件的安装服务（作者侧一键启用）。
 *
 * 走 Runtime 的插件管理器节点（install → enable → activate），与手动放 zip 安装
 * 完全同一条路径、同一套授权与台账；字节来自随产品打包的内置包
 * （bundled-narrator-team.ts），作者不需要 GitHub 访问或任何手动步骤。
 */

import { createHash } from "node:crypto";

import { BUNDLED_NARRATOR_TEAM, bundledNarratorTeamBytes } from "./bundled-narrator-team";

/** Runtime 插件管理器里本服务用到的最小形状；生产注入单例，测试注入假件。 */
export interface BundledPluginManager {
  install(source: Uint8Array | File): Promise<unknown>;
  enable(pluginId: string): Promise<unknown>;
  activate(pluginId: string): Promise<unknown>;
  getStatus(pluginId: string): Promise<unknown>;
}

export interface BundledNarratorTeamState {
  readonly installed: boolean;
  readonly runtimeState: string | null;
  readonly detail?: unknown;
}

export interface BundledNarratorTeamInstallResult {
  readonly status: "installed" | "already-active";
  readonly runtimeState: string | null;
}

function runtimeStateOf(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const record = detail as Record<string, unknown>;
  const runtime = typeof record.runtimeState === "string" ? record.runtimeState : null;
  if (runtime) return runtime;
  const state = typeof record.state === "string" ? record.state : null;
  return state;
}

/** 内置包字节与清单哈希自校验（发行资产损坏要在产品侧先炸，不要交到插件管理器）。 */
export function verifyBundledNarratorTeam(): { ok: boolean; expected: string; actual: string } {
  const actual = createHash("sha256").update(bundledNarratorTeamBytes()).digest("hex");
  return { ok: actual === BUNDLED_NARRATOR_TEAM.sha256, expected: BUNDLED_NARRATOR_TEAM.sha256, actual };
}

export async function bundledNarratorTeamState(manager: BundledPluginManager): Promise<BundledNarratorTeamState> {
  try {
    const detail = await manager.getStatus(BUNDLED_NARRATOR_TEAM.pluginId);
    return { installed: Boolean(detail), runtimeState: runtimeStateOf(detail), ...(detail ? { detail } : {}) };
  } catch {
    return { installed: false, runtimeState: null };
  }
}

/**
 * 幂等安装：已激活直接报 already-active；否则按内置包字节走装 → 启 → 激活。
 * 每步错误原样上抛（install / enable / activate 各自的 AppError 已由 Runtime 定义好）。
 */
export async function installBundledNarratorTeam(
  manager: BundledPluginManager,
): Promise<BundledNarratorTeamInstallResult> {
  const current = await bundledNarratorTeamState(manager);
  if (current.runtimeState === "active") {
    return { status: "already-active", runtimeState: current.runtimeState };
  }
  const integrity = verifyBundledNarratorTeam();
  if (!integrity.ok) {
    throw new Error(`内置 narrator-team 发行包校验失败：期望 sha256 ${integrity.expected}，实际 ${integrity.actual}`);
  }
  await manager.install(bundledNarratorTeamBytes());
  await manager.enable(BUNDLED_NARRATOR_TEAM.pluginId);
  await manager.activate(BUNDLED_NARRATOR_TEAM.pluginId);
  const after = await bundledNarratorTeamState(manager);
  return { status: "installed", runtimeState: after.runtimeState };
}
