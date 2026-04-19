/**
 * useLLMConfig — manage LLM API credentials (session-based or localStorage)
 * Open mode: users can manually configure API Key without Sub2API login
 */

import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "./use-api";
import { useNovelFork } from "../providers/novelfork-context";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  hasApiKey: boolean;
}

export function useLLMConfig() {
  const { mode } = useNovelFork();
  const isTauri = mode === "tauri";
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isTauri) {
        // Tauri: read from localStorage
        const raw = localStorage.getItem("novelfork-llm-config");
        if (raw) {
          const parsed = JSON.parse(raw);
          setConfig({
            apiKey: parsed.apiKey ?? "",
            baseUrl: parsed.baseUrl ?? "",
            model: parsed.model ?? "gpt-4o",
            provider: parsed.provider ?? "openai",
            hasApiKey: Boolean(parsed.apiKey),
          });
        } else {
          setConfig({
            apiKey: "",
            baseUrl: "",
            model: "gpt-4o",
            provider: "openai",
            hasApiKey: false,
          });
        }
      } else {
        // Web: read from session cookie via API
        const data = await fetchJson<LLMConfig>("/auth/llm-settings");
        setConfig(data);
      }
    } catch {
      setConfig({
        apiKey: "",
        baseUrl: "",
        model: "gpt-4o",
        provider: "openai",
        hasApiKey: false,
      });
    } finally {
      setLoading(false);
    }
  }, [isTauri]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (updates: Partial<Omit<LLMConfig, "hasApiKey">>) => {
      setSaving(true);
      try {
        if (isTauri) {
          // Tauri: save to localStorage
          const current = config ?? {
            apiKey: "",
            baseUrl: "",
            model: "gpt-4o",
            provider: "openai",
            hasApiKey: false,
          };
          const updated = { ...current, ...updates };
          localStorage.setItem(
            "novelfork-llm-config",
            JSON.stringify({
              apiKey: updated.apiKey,
              baseUrl: updated.baseUrl,
              model: updated.model,
              provider: updated.provider,
            })
          );
          setConfig({
            ...updated,
            hasApiKey: Boolean(updated.apiKey),
          });
        } else {
          // Web: save to session cookie via API
          await fetchJson("/auth/llm-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          });
          await load();
        }
      } finally {
        setSaving(false);
      }
    },
    [isTauri, config, load]
  );

  return { config, loading, saving, save, reload: load };
}
