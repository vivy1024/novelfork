/**
 * 全书叙事结构共享 Hook（useNarrativeStructure）。
 *
 * 任务书 4 核心产物：
 * 将全书 16+ 个面板各自碎片化发起的多次网络请求，收拢为对
 * `GET /api/books/:bookId/narrative-structure` 的单次请求与共享缓存。
 * 支持相同 bookId 请求去重、自动取消与手动重载。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NarrativeStructurePayload } from "../../engine/narrative-taxonomy/narrative-structure.js";

export type NarrativeStructureState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: NarrativeStructurePayload };

// 全局在途请求去重缓存池。共享请求不绑定任何一个调用者的 AbortSignal：
// 否则先挂载的面板卸载（或开发模式 StrictMode 首次挂载被清理）时会中止请求，
// 同时复用它的其他面板全部拿到 AbortError。调用者取消时只忽略结果。
const inFlightRequests = new Map<string, Promise<NarrativeStructurePayload>>();

async function fetchNarrativeStructure(bookId: string): Promise<NarrativeStructurePayload> {
  const existing = inFlightRequests.get(bookId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-structure`);
      if (!res.ok) {
        throw new Error(`读取叙事结构失败: HTTP ${res.status}`);
      }
      const data = (await res.json()) as NarrativeStructurePayload;
      return data;
    } finally {
      inFlightRequests.delete(bookId);
    }
  })();

  inFlightRequests.set(bookId, promise);
  return promise;
}

export function useNarrativeStructure(bookId: string | undefined): {
  readonly state: NarrativeStructureState;
  readonly reload: () => void;
} {
  const [state, setState] = useState<NarrativeStructureState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const activeBookIdRef = useRef<string | undefined>(bookId);
  activeBookIdRef.current = bookId;

  const reload = useCallback(() => {
    if (bookId) inFlightRequests.delete(bookId);
    setNonce((n) => n + 1);
  }, [bookId]);

  useEffect(() => {
    if (!bookId?.trim()) {
      setState({ status: "error", message: "未指定作品 ID" });
      return;
    }

    let cancelled = false;

    setState({ status: "loading" });

    fetchNarrativeStructure(bookId)
      .then((data) => {
        if (!cancelled && activeBookIdRef.current === bookId) {
          setState({ status: "ready", data });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && activeBookIdRef.current === bookId) {
          const message = err instanceof Error ? err.message : "读取全书叙事结构失败";
          setState({ status: "error", message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, nonce]);

  return { state, reload };
}
