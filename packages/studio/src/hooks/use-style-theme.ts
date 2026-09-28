import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_STYLE_THEME, isStyleThemeId, type StyleThemeId } from "@/styles/style-themes";

/**
 * 书房主题（绿格稿纸 / 书函藏青 / 夜更烛光）：挂在 <html data-nf-style>，与明暗（<html class="dark">）互不影响。
 * 只存在当前设备的浏览器里，和明暗主题一样不写入 Runtime。
 */

const STORAGE_KEY = "novelfork:style-theme";
const listeners = new Set<() => void>();

function loadStoredStyleTheme(): StyleThemeId {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isStyleThemeId(stored)) return stored;
  } catch { /* 受限环境读不到存储时用默认主题 */ }
  return DEFAULT_STYLE_THEME;
}

function applyStyleThemeToDOM(theme: StyleThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.nfStyle = theme;
}

function readCurrentStyleTheme(): StyleThemeId {
  if (typeof document === "undefined") return DEFAULT_STYLE_THEME;
  const current = document.documentElement.dataset.nfStyle;
  return isStyleThemeId(current) ? current : DEFAULT_STYLE_THEME;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    applyStyleThemeToDOM(loadStoredStyleTheme());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setStyleTheme(theme: StyleThemeId) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, theme); } catch { /* 存不下时只影响本次会话 */ }
  applyStyleThemeToDOM(theme);
  for (const listener of listeners) listener();
}

export function useStyleTheme() {
  const styleTheme = useSyncExternalStore(subscribe, readCurrentStyleTheme, () => DEFAULT_STYLE_THEME);
  const set = useCallback((theme: StyleThemeId) => setStyleTheme(theme), []);
  return { styleTheme, setStyleTheme: set } as const;
}

/** 入口处尽早调用，避免首屏先按默认主题画一遍再闪成已选主题。 */
export function initStyleTheme() {
  applyStyleThemeToDOM(loadStoredStyleTheme());
}
