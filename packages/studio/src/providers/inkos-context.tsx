/**
 * InkOS context provider — injects storage + AI adapters into the React tree.
 * Components use useInkOS() instead of importing concrete implementations.
 */

import { createContext, useContext, useMemo, useState, useEffect } from "react";
import type { ClientStorageAdapter } from "../storage/adapter.js";
import type { AIClient } from "../ai/client.js";
import { HttpStorageAdapter } from "../storage/http-adapter.js";
import { HttpAIClient } from "../ai/http-client.js";
import { fetchJson } from "../hooks/use-api.js";

export type InkosMode = "standalone" | "relay";

interface InkOSContextValue {
  readonly storage: ClientStorageAdapter;
  readonly ai: AIClient;
  readonly mode: InkosMode;
}

const InkOSContext = createContext<InkOSContextValue | null>(null);

export function InkOSProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<InkosMode>("standalone");

  useEffect(() => {
    fetchJson<{ mode: InkosMode }>("/mode")
      .then((res) => setMode(res.mode))
      .catch(() => setMode("standalone"));
  }, []);

  const storage = useMemo(() => new HttpStorageAdapter(), []);
  const ai = useMemo(() => new HttpAIClient(), []);

  const value = useMemo<InkOSContextValue>(
    () => ({ storage, ai, mode }),
    [storage, ai, mode],
  );

  return (
    <InkOSContext.Provider value={value}>
      {children}
    </InkOSContext.Provider>
  );
}

export function useInkOS(): InkOSContextValue {
  const ctx = useContext(InkOSContext);
  if (!ctx) throw new Error("useInkOS must be used within <InkOSProvider>");
  return ctx;
}
