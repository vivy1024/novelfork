/**
 * 角色内核的前端读取封装。
 *
 * 与 narrative-fact-edits 的取数样式一致：把后端 routing 与 ui 解耦，
 * 这样角色册面板和实体详情页共用同一个拉取代码，不出现两份拼接的路径。
 */

import { fetchJson } from "@/hooks/use-api";

export interface CharacterKernelSummary {
  characterId: string;
  entryStatus: "active" | "archived";
  /** 键值对；键在作品的字段配置里定义，前端只能按当前已知键渲染 */
  fields: Record<string, string | readonly string[]>;
  updatedChapter: number;
  updatedAt: string;
  origin: "settle" | "manual" | "import";
}

export interface KernelsResponse {
  kernels?: readonly CharacterKernelSummary[];
  total?: number;
}

function kernelBase(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory/kernels`;
}

/** 一次拉全部：角色内核在全书中通常关系列 < 角色卡数量，一次取完比按需拉更省 RTT。 */
export async function fetchCharacterKernels(
  bookId: string,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<CharacterKernelSummary[]> {
  const payload = await fetchJson<KernelsResponse>(kernelBase(bookId), {}, { fetchImpl: options.fetchImpl });
  return payload.kernels ?? [];
}
