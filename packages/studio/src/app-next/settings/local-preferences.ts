import { useCallback, useEffect, useRef, useState } from "react";

export type LocalBooleanPreferenceKey =
  | "narrafork_oled"
  | "narrafork_fullscreen"
  | "narrafork_wakelock"
  | "narrafork_advanced_anim"
  | "narrafork_expand_reasoning";

export type NarratorMessageRendererMode = "react" | "pixi";

export const NARRATOR_MESSAGE_RENDERER_KEY = "narrafork_narrator_message_renderer";
const LOCAL_PREFERENCE_EVENT = "novelfork:local-preference-change";

function readStoredValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Browsers may deny storage in private or restricted contexts.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_PREFERENCE_EVENT, { detail: { key } }));
  }
}

export function useLocalBooleanPreference(
  key: LocalBooleanPreferenceKey,
  defaultValue = false,
): readonly [boolean, (value: boolean) => void] {
  const read = useCallback(() => {
    const stored = readStoredValue(key);
    return stored === null ? defaultValue : stored === "true";
  }, [defaultValue, key]);
  const [value, setValue] = useState(read);

  useEffect(() => {
    setValue(read());
    if (typeof window === "undefined") return;
    const handleChange = (event: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key === key) setValue(read());
        return;
      }
      const changedKey = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (changedKey === key) setValue(read());
    };
    window.addEventListener("storage", handleChange);
    window.addEventListener(LOCAL_PREFERENCE_EVENT, handleChange);
    return () => {
      window.removeEventListener("storage", handleChange);
      window.removeEventListener(LOCAL_PREFERENCE_EVENT, handleChange);
    };
  }, [key, read]);

  const update = useCallback((next: boolean) => {
    writeStoredValue(key, String(next));
    setValue(next);
  }, [key]);

  return [value, update] as const;
}

export function useNarratorMessageRendererMode(): readonly [
  NarratorMessageRendererMode,
  (mode: NarratorMessageRendererMode) => void,
] {
  const read = useCallback((): NarratorMessageRendererMode => {
    const stored = readStoredValue(NARRATOR_MESSAGE_RENDERER_KEY);
    return stored === "pixi" ? "pixi" : "react";
  }, []);
  const [mode, setMode] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleChange = (event: Event) => {
      const key = event instanceof StorageEvent
        ? event.key
        : (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === NARRATOR_MESSAGE_RENDERER_KEY) setMode(read());
    };
    window.addEventListener("storage", handleChange);
    window.addEventListener(LOCAL_PREFERENCE_EVENT, handleChange);
    return () => {
      window.removeEventListener("storage", handleChange);
      window.removeEventListener(LOCAL_PREFERENCE_EVENT, handleChange);
    };
  }, [read]);

  const update = useCallback((next: NarratorMessageRendererMode) => {
    writeStoredValue(NARRATOR_MESSAGE_RENDERER_KEY, next);
    setMode(next);
  }, []);

  return [mode, update] as const;
}

interface ScreenWakeLockSentinel {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: "screen"): Promise<ScreenWakeLockSentinel> };
}

export function useScreenWakeLock(enabled: boolean): void {
  const lockRef = useRef<ScreenWakeLockSentinel | null>(null);

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!enabled || !wakeLock) return;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        lockRef.current = lock;
        lock.addEventListener("release", () => {
          if (lockRef.current === lock) lockRef.current = null;
        });
      } catch {
        // Permission denial and unsupported contexts leave the preference intact.
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !lockRef.current) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void lockRef.current?.release();
      lockRef.current = null;
    };
  }, [enabled]);
}
