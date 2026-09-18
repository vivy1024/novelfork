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

// 全局在途请求去重缓存池
const inFlightRequests = new Map<string, Promise<NarrativeStructurePayload>>();

async function fetchNarrativeStructure(
  bookId: string,
  signal?: AbortSignal,
): Promise<NarrativeStructurePayload> {
  const existing = inFlightRequests.get(bookId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/narrative-structure`,
        { signal },
      );
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
    const controller = new AbortController();

    setState({ status: "loading" });

    fetchNarrativeStructure(bookId, controller.signal)
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
      controller.abort();
    };
  }, [bookId, nonce]);

  return { state, reload };
}
