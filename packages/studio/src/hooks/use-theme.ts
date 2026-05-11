import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "auto";

const STORAGE_KEY = "novelfork:theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "auto" ? getSystemTheme() : theme;
}

function applyThemeToDOM(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

function loadStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch { /* ignore */ }
  return "light";
}

export function useTheme(initialTheme?: Theme) {
  const [theme, setThemeState] = useState<Theme>(() => initialTheme ?? loadStoredTheme());
  const resolved = resolveTheme(theme);

  // Apply theme to DOM on mount and change
  useEffect(() => {
    applyThemeToDOM(resolved);
  }, [resolved]);

  // Listen for system theme changes when in "auto" mode
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyThemeToDOM(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try { localStorage.setItem(STORAGE_KEY, newTheme); } catch { /* ignore */ }
    applyThemeToDOM(resolveTheme(newTheme));
  }, []);

  const toggleTheme = useCallback(() => {
    const next = resolved === "dark" ? "light" : "dark";
    setTheme(next);
  }, [resolved, setTheme]);

  return {
    theme,
    resolvedTheme: resolved,
    setTheme,
    toggleTheme,
  } as const;
}

/** Apply theme immediately on page load (call in index.html or entry point) */
export function initTheme() {
  const stored = loadStoredTheme();
  applyThemeToDOM(resolveTheme(stored));
}
