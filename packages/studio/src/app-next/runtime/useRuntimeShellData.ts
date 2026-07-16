import { useCallback, useEffect, useRef, useState } from "react";

import { createRuntimeProductClient } from "./product-contract";
import { createRuntimeNarratorClient } from "./runtime-narrator-client";
import {
  loadRuntimeShellData,
  type RuntimeShellData,
  type RuntimeShellDataClient,
  type RuntimeShellNarratorClient,
} from "./shell-data";

export interface UseRuntimeShellDataResult extends Omit<RuntimeShellData, "error"> {
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reload: () => Promise<void>;
}

const EMPTY_DATA: RuntimeShellData = {
  books: [],
  sessions: [],
  recentTabs: [],
  providerSummary: null,
  providerStatus: { hasUsableModel: false, label: "正在连接 Runtime" },
  error: null,
};

/** Runtime-backed shell loader with focus and lightweight status refresh. */
export function useRuntimeShellData(
  client: RuntimeShellDataClient = createRuntimeProductClient(),
  narratorClient?: RuntimeShellNarratorClient,
  activeNarratorId?: string,
): UseRuntimeShellDataResult {
  const defaultNarratorClientRef = useRef<RuntimeShellNarratorClient | null>(null);
  if (!defaultNarratorClientRef.current) defaultNarratorClientRef.current = createRuntimeNarratorClient();
  const effectiveNarratorClient = narratorClient ?? defaultNarratorClientRef.current;
  const clientRef = useRef(client);
  const narratorClientRef = useRef(effectiveNarratorClient);
  const activeNarratorIdRef = useRef(activeNarratorId);
  clientRef.current = client;
  narratorClientRef.current = effectiveNarratorClient;
  activeNarratorIdRef.current = activeNarratorId;
  const [data, setData] = useState<RuntimeShellData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true);
    try {
      const next = await loadRuntimeShellData(
        clientRef.current,
        narratorClientRef.current,
        activeNarratorIdRef.current,
      );
      setData(next);
      setError(null);
    } catch (cause) {
      if (showLoading) setData(EMPTY_DATA);
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => refresh(true), [refresh]);

  useEffect(() => {
    void reload();
  }, [activeNarratorId, reload]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    const interval = window.setInterval(refreshVisible, 15_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  return { ...data, loading, error, reload };
}
