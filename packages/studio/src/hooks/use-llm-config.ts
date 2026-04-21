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
        const rawProfiles = localStorage.getItem("novelfork-llm-profiles");
        const activeName = localStorage.getItem("novelfork-llm-active");
        if (rawProfiles) {
          const profiles = JSON.parse(rawProfiles) as Array<{ name: string; apiKey?: string; baseUrl?: string; model?: string; provider?: string }>;
          const active = activeName ? profiles.find((profile) => profile.name === activeName) : profiles[0];
          if (active) {
            setConfig({
              apiKey: active.apiKey ?? "",
              baseUrl: active.baseUrl ?? "",
              model: active.model ?? "gpt-4o",
              provider: active.provider ?? "openai",
              hasApiKey: Boolean(active.apiKey),
            });
            return;
          }
        }

        setConfig({
          apiKey: "",
          baseUrl: "",
          model: "gpt-4o",
          provider: "openai",
          hasApiKey: false,
        });
      } else {
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
          const current = config ?? {
            apiKey: "",
            baseUrl: "",
            model: "gpt-4o",
            provider: "openai",
            hasApiKey: false,
          };
          const updated = { ...current, ...updates };
          const profile = {
            name: localStorage.getItem("novelfork-llm-active") || "默认",
            apiKey: updated.apiKey,
            baseUrl: updated.baseUrl,
            model: updated.model,
            provider: updated.provider,
          };
          localStorage.setItem("novelfork-llm-profiles", JSON.stringify([profile]));
          localStorage.setItem("novelfork-llm-active", profile.name);
          setConfig({
            ...updated,
            hasApiKey: Boolean(updated.apiKey),
          });
        } else {
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
    [isTauri, config, load],
  );

  return { config, loading, saving, save, reload: load };
}
