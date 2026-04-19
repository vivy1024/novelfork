/**
 * NovelFork context provider — injects storage + AI adapters into the React tree.
 * Components use useNovelFork() instead of importing concrete implementations.
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
import { setTauriBridge } from "../hooks/tauri-api-bridge.js";

export type NovelForkMode = "standalone" | "relay" | "tauri";

interface NovelForkContextValue {
  readonly storage: ClientStorageAdapter;
  readonly ai: AIClient;
  readonly mode: NovelForkMode;
  readonly selectWorkspace?: () => Promise<string | null>;
  readonly workspace?: string | null;
  readonly tauriAuthenticated?: boolean;
  readonly loginWithToken?: (token: string) => Promise<void>;
  readonly skipAuth?: () => void;
}

const NovelForkContext = createContext<NovelForkContextValue | null>(null);

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Default web adapters (created once)
const httpStorage = new HttpStorageAdapter();
const httpAI = new HttpAIClient();

export function NovelForkProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<NovelForkContextValue>({
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
    <NovelForkContext.Provider value={ctx}>
      {children}
    </NovelForkContext.Provider>
  );
}

async function initTauriMode(setCtx: (v: NovelForkContextValue) => void): Promise<void> {
  const { TauriStorageAdapter, setWorkspace, getWorkspace } = await import("../storage/tauri-adapter.js");
  const { RelayAIClient } = await import("../ai/relay-client.js");

  // Try to restore last workspace from localStorage
  const saved = localStorage.getItem("novelfork-workspace");
  if (saved) setWorkspace(saved);

  const storage = new TauriStorageAdapter();

  // Activate the Tauri API bridge so useApi/fetchJson route locally
  setTauriBridge(storage);

  // Relay URL defaults to production; can be overridden via localStorage
  const relayUrl = localStorage.getItem("novelfork-relay-url") ?? "https://inkos.vivy1024.cc";

  const ai = new RelayAIClient({
    relayUrl,
    storage,
    getAuthHeaders: async (): Promise<Record<string, string>> => {
      const token = localStorage.getItem("novelfork-auth-token");
      if (token) return { Authorization: `Bearer ${token}` };
      return {};
    },
    getLLMConfig: async () => {
      const raw = localStorage.getItem("novelfork-llm-config");
      if (raw) return JSON.parse(raw);
      return { apiKey: "", baseUrl: "", model: "gpt-4o" };
    },
  });

  const selectWorkspace = async (): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("@tauri-apps/api/core") as any;
    const folder = await mod.invoke("select_workspace");
    if (folder) {
      setWorkspace(folder);
      localStorage.setItem("novelfork-workspace", folder);
    }
    return folder;
  };

  const hasAuth = Boolean(localStorage.getItem("novelfork-auth-token"));

  // Skip auth — allow offline use without a relay token
  const skipAuth = (): void => {
    setCtx({
      storage, ai, mode: "tauri", selectWorkspace,
      workspace: getWorkspace(),
      tauriAuthenticated: true,
      loginWithToken,
      skipAuth,
    });
  };

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
          localStorage.setItem("novelfork-llm-config", JSON.stringify({
            apiKey: payload.llm_api_key ?? "",
            baseUrl: payload.llm_base_url ?? "",
            model: payload.llm_model ?? "gpt-4o",
            provider: payload.llm_provider ?? "openai",
          }));
        }
      } catch { /* ignore decode errors */ }
    }

    // Store auth token for relay requests
    localStorage.setItem("novelfork-auth-token", token);

    // Update context with authenticated state
    setCtx({
      storage, ai, mode: "tauri", selectWorkspace,
      workspace: getWorkspace(),
      tauriAuthenticated: true,
      loginWithToken,
      skipAuth,
    });
  };

  // Build initial context
  const buildCtx = (): NovelForkContextValue => ({
    storage, ai, mode: "tauri", selectWorkspace,
    workspace: getWorkspace(),
    tauriAuthenticated: hasAuth,
    loginWithToken,
    skipAuth,
  });

  setCtx(buildCtx());

  // Listen for deep link events (novelfork://launch?token=xxx)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventMod = await import("@tauri-apps/api/event") as any;
    eventMod.listen("novelfork-launch", (event: { payload: string }) => {
      if (event.payload) {
        loginWithToken(event.payload).catch(console.error);
      }
    });
  } catch { /* deep link listener not available */ }
}

export function useNovelFork(): NovelForkContextValue {
  const ctx = useContext(NovelForkContext);
  if (!ctx) throw new Error("useNovelFork must be used within <NovelForkProvider>");
  return ctx;
}
