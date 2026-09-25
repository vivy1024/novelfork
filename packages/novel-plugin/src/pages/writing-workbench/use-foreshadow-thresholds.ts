import { useEffect, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import {
  DEFAULT_FORESHADOW_DEBT_THRESHOLDS,
  resolveForeshadowDebtThresholds,
  type ForeshadowDebtThresholds,
} from "../../engine/narrative-taxonomy/foreshadow-debts";
import { useWritingProgressRefresh } from "./use-writing-progress-refresh";

/**
 * 本书的伏笔债务阈值。权威源是 book.json 的 foreshadowDebtThresholds（作者在书籍设置里改）；
 * 这里只读、不缓存，读不到或不合法时用默认值。书籍设置保存后会派发写作进度事件，
 * 已打开的面板据此重读，不需要刷新页面。
 */
export function useForeshadowThresholds(bookId: string | undefined): ForeshadowDebtThresholds {
  const [thresholds, setThresholds] = useState<ForeshadowDebtThresholds>(DEFAULT_FORESHADOW_DEBT_THRESHOLDS);
  const [nonce, setNonce] = useState(0);
  useWritingProgressRefresh(bookId, () => setNonce((value) => value + 1));

  useEffect(() => {
    if (!bookId) {
      setThresholds(DEFAULT_FORESHADOW_DEBT_THRESHOLDS);
      return;
    }
    let cancelled = false;
    void fetchJson<Record<string, unknown>>(`/api/books/${encodeURIComponent(bookId)}`)
      .then((data) => {
        if (cancelled) return;
        const book = data && typeof data.book === "object" && data.book ? data.book as Record<string, unknown> : data;
        setThresholds(resolveForeshadowDebtThresholds(book?.foreshadowDebtThresholds));
      })
      .catch(() => {
        if (!cancelled) setThresholds(DEFAULT_FORESHADOW_DEBT_THRESHOLDS);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, nonce]);

  return thresholds;
}
