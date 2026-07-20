import { useEffect, useSyncExternalStore } from "react";
import { getLocaleDirection, normalizeLocale, type Locale } from "@vivy1024/novelfork-core/i18n";
import { createUserPreferencesClient } from "../runtime-admin";

const PRODUCT_DEFAULT_LOCALE: Locale = "zh-CN";
const preferencesClient = createUserPreferencesClient();

type RuntimeLocaleClient = Pick<typeof preferencesClient, "get" | "patch">;
type LocaleStatus = "idle" | "loading" | "ready" | "error";

export interface RuntimeLocaleSnapshot {
  readonly locale: Locale;
  readonly status: LocaleStatus;
  readonly error: string | null;
}

let snapshot: RuntimeLocaleSnapshot = {
  locale: PRODUCT_DEFAULT_LOCALE,
  status: "idle",
  error: null,
};
let inFlight: Promise<Locale> | null = null;
let requestGeneration = 0;
const listeners = new Set<() => void>();

function publish(next: RuntimeLocaleSnapshot): void {
  if (
    next.locale === snapshot.locale
    && next.status === snapshot.status
    && next.error === snapshot.error
  ) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function getRuntimeLocaleSnapshot(): RuntimeLocaleSnapshot {
  return snapshot;
}

export function subscribeRuntimeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Converts Runtime's canonical locale to the legacy Studio string-table key. */
export function toStudioLanguage(locale: string | null | undefined): "zh" | "en" {
  return normalizeLocale(locale, PRODUCT_DEFAULT_LOCALE) === "en" ? "en" : "zh";
}

/** Updates the in-memory mirror only after Runtime has accepted the preference. */
export function publishRuntimeLocale(locale: string | null | undefined): Locale {
  const canonical = normalizeLocale(locale, PRODUCT_DEFAULT_LOCALE);
  publish({ locale: canonical, status: "ready", error: null });
  return canonical;
}

export function resetRuntimeLocale(): void {
  requestGeneration += 1;
  inFlight = null;
  publish({ locale: PRODUCT_DEFAULT_LOCALE, status: "idle", error: null });
}

export async function refreshRuntimeLocale(
  client: RuntimeLocaleClient = preferencesClient,
): Promise<Locale> {
  if (inFlight) return inFlight;

  const generation = ++requestGeneration;
  publish({ ...snapshot, status: "loading", error: null });
  inFlight = client.get()
    .then((preferences) => {
      const canonical = normalizeLocale(preferences.language, PRODUCT_DEFAULT_LOCALE);
      if (generation === requestGeneration) publishRuntimeLocale(canonical);
      return canonical;
    })
    .catch((reason) => {
      if (generation === requestGeneration) {
        publish({ ...snapshot, status: "error", error: errorMessage(reason) });
      }
      throw reason;
    })
    .finally(() => {
      if (generation === requestGeneration) inFlight = null;
    });
  return inFlight;
}

export async function saveRuntimeLocale(
  locale: Locale,
  client: RuntimeLocaleClient = preferencesClient,
): Promise<Locale> {
  const canonical = normalizeLocale(locale, PRODUCT_DEFAULT_LOCALE);
  const generation = ++requestGeneration;
  inFlight = null;
  const preferences = await client.patch({ language: canonical });
  const saved = normalizeLocale(preferences.language, PRODUCT_DEFAULT_LOCALE);
  if (generation === requestGeneration) publishRuntimeLocale(saved);
  return saved;
}

export function RuntimeLocaleDocumentSync() {
  const { locale } = useRuntimeLocale();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = getLocaleDirection(locale);
    return () => {
      document.documentElement.lang = PRODUCT_DEFAULT_LOCALE;
      document.documentElement.dir = getLocaleDirection(PRODUCT_DEFAULT_LOCALE);
    };
  }, [locale]);

  return null;
}

export function useRuntimeLocale() {
  const current = useSyncExternalStore(
    subscribeRuntimeLocale,
    getRuntimeLocaleSnapshot,
    getRuntimeLocaleSnapshot,
  );

  useEffect(() => {
    if (current.status !== "idle") return;
    void refreshRuntimeLocale().catch(() => undefined);
  }, [current.status]);

  return {
    ...current,
    refresh: refreshRuntimeLocale,
    setLocale: saveRuntimeLocale,
  } as const;
}
