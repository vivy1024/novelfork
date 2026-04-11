/**
 * InkOS context provider — injects storage + AI adapters into the React tree.
 * Components use useInkOS() instead of importing concrete implementations.
 *
 * Detects Tauri environment automatically:
 * - Tauri: TauriStorageAdapter + RelayAIClient
 * - Web:   HttpStorageAdapter + HttpAIClient
 */

import { createContext, useContext, useState, useEffect } from "react";
import type { ClientStorageAdapter } from "../storage/adapter.js";
import type { AIClient } from "../ai/client.js";
import { HttpStorageAdapter } from "../storage/http-adapter.js";
import { HttpAIClient } from "../ai/http-client.js";
import { fetchJson } from "../hooks/use-api.js";

export type InkosMode = "standalone" | "relay" | "tauri";

interface InkOSContextValue {
  readonly storage: ClientStorageAdapter;
  readonly ai: AIClient;
  readonly mode: InkosMode;
  readonly selectWorkspace?: () => Promise<string | null>;
  readonly workspace?: string | null;
  readonly tauriAuthenticated?: boolean;
  readonly loginWithToken?: (token: string) => Promise<void>;
}

const InkOSContext = createContext<InkOSContextValue | null>(null);

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Default web adapters (created once)
const httpStorage = new HttpStorageAdapter();
const httpAI = new HttpAIClient();

export function InkOSProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<InkOSContextValue>({
    storage: httpStorage,
    ai: httpAI,
    mode: "standalone",
  });

  useEffect(() => {
    if (isTauri()) {
      initTauriMode(setCtx).catch(() => {
        // Fallback to web mode if Tauri init fails
      });
    } else {
      // Web mode — check server mode
      fetchJson<{ mode: string }>("/mode")
        .then((res) => {
          const mode = res.mode === "relay" ? "relay" as const : "standalone" as const;
          setCtx({ storage: httpStorage, ai: httpAI, mode });
        })
        .catch(() => {});
    }
  }, []);

  return (
    <InkOSContext.Provider value={ctx}>
      {children}
    </InkOSContext.Provider>
  );
}

async function initTauriMode(setCtx: (v: InkOSContextValue) => void): Promise<void> {
  const { TauriStorageAdapter, setWorkspace, getWorkspace } = await import("../storage/tauri-adapter.js");
  const { RelayAIClient } = await import("../ai/relay-client.js");

  // Try to restore last workspace from localStorage
  const saved = localStorage.getItem("inkos-workspace");
  if (saved) setWorkspace(saved);

  const storage = new TauriStorageAdapter();

  // Relay URL defaults to production; can be overridden via localStorage
  const relayUrl = localStorage.getItem("inkos-relay-url") ?? "https://inkos.vivy1024.cc";

  const ai = new RelayAIClient({
    relayUrl,
    storage,
    getAuthHeaders: async (): Promise<Record<string, string>> => {
      const token = localStorage.getItem("inkos-auth-token");
      if (token) return { Authorization: `Bearer ${token}` };
      return {};
    },
    getLLMConfig: async () => {
      const raw = localStorage.getItem("inkos-llm-config");
      if (raw) return JSON.parse(raw);
      return { apiKey: "", baseUrl: "", model: "gpt-4o" };
    },
  });

  const selectWorkspace = async (): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (Function('return import("@tauri-apps/api/core")')() as Promise<any>);
    const folder = await mod.invoke("select_workspace");
    if (folder) {
      setWorkspace(folder);
      localStorage.setItem("inkos-workspace", folder);
    }
    return folder;
  };

  const hasAuth = Boolean(localStorage.getItem("inkos-auth-token"));

  // Process a launch token: verify with relay, store credentials
  const loginWithToken = async (token: string): Promise<void> => {
    const res = await fetch(`${relayUrl}/api/auth/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: "Login failed" } }));
      throw new Error(err?.error?.message ?? "Login failed");
    }
    const data = await res.json() as { ok: boolean; session: { userId: number; email: string } };

    // Decode JWT payload to extract LLM config (without verifying — relay already verified)
    const parts = token.split(".");
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload.llm_api_key || payload.llm_base_url) {
          localStorage.setItem("inkos-llm-config", JSON.stringify({
            apiKey: payload.llm_api_key ?? "",
            baseUrl: payload.llm_base_url ?? "",
            model: payload.llm_model ?? "gpt-4o",
            provider: payload.llm_provider ?? "openai",
          }));
        }
      } catch { /* ignore decode errors */ }
    }

    // Store auth token for relay requests
    localStorage.setItem("inkos-auth-token", token);

    // Update context with authenticated state
    setCtx({
      storage, ai, mode: "tauri", selectWorkspace,
      workspace: getWorkspace(),
      tauriAuthenticated: true,
      loginWithToken,
    });
  };

  // Build initial context
  const buildCtx = (): InkOSContextValue => ({
    storage, ai, mode: "tauri", selectWorkspace,
    workspace: getWorkspace(),
    tauriAuthenticated: hasAuth,
    loginWithToken,
  });

  setCtx(buildCtx());

  // Listen for deep link events (inkos://launch?token=xxx)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventMod = await (Function('return import("@tauri-apps/api/event")')() as Promise<any>);
    eventMod.listen("inkos-launch", (event: { payload: string }) => {
      if (event.payload) {
        loginWithToken(event.payload).catch(console.error);
      }
    });
  } catch { /* deep link listener not available */ }
}

export function useInkOS(): InkOSContextValue {
  const ctx = useContext(InkOSContext);
  if (!ctx) throw new Error("useInkOS must be used within <InkOSProvider>");
  return ctx;
}
