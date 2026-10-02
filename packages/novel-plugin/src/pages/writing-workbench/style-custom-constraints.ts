import { fetchJson } from "@/hooks/use-api";
import { extractCustomConstraints } from "../../engine/writing-layers/style-preset-custom-constraints";

export interface StylePresetLikeResponse {
  readonly preset?: unknown;
}

/** 从预设响应里取作者硬约束；字段未启用时返回 null（注入点与现状逐字一致）。 */
export function customConstraintsFromPresetResponse(response: StylePresetLikeResponse | null | undefined): readonly string[] {
  return extractCustomConstraints(response?.preset)?.constraints ?? [];
}

/**
 * 发叙述者指令前读取当前本书硬约束（作者可能刚在文风页改过，随取随用）。
 * 读取失败抛给调用处：由调用处决定提示后继续不带约束执行，不静默伪装。
 */
export async function fetchCustomConstraints(bookId: string): Promise<readonly string[]> {
  const response = await fetchJson<StylePresetLikeResponse>(
    `/api/books/${encodeURIComponent(bookId)}/style/preset`,
  );
  return customConstraintsFromPresetResponse(response);
}
