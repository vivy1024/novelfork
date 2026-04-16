import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = "light" | "dark" | "auto";

const THEME_STORAGE_KEY = "inkos:studio:theme";

interface ThemeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getTimeBasedThemeForHour(hour: number): Theme {
  return hour >= 6 && hour < 18 ? "light" : "dark";
}

function getTimeBasedTheme(): Theme {
  return getTimeBasedThemeForHour(new Date().getHours());
}

function getThemeStorage(): ThemeStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredTheme(storage: Pick<ThemeStorageLike, "getItem"> | null | undefined): ThemePreference | null {
  const storedTheme = storage?.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" || storedTheme === "auto" ? storedTheme : null;
}

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveThemePreference(params: {
  readonly hour: number;
  readonly storedTheme: ThemePreference | null;
}): Theme {
  if (params.storedTheme === "auto") {
    return getSystemTheme();
  }
  return params.storedTheme ?? getTimeBasedThemeForHour(params.hour);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveThemePreference({
      hour: new Date().getHours(),
      storedTheme: readStoredTheme(getThemeStorage()),
    }),
  );

  useEffect(() => {
    // 监听系统主题变化
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const storedTheme = readStoredTheme(getThemeStorage());
      if (storedTheme === "auto") {
        setThemeState(getSystemTheme());
      }
    };
    mediaQuery.addEventListener("change", handleChange);

    // 定时检查（用于时间基础主题）
    const timer = setInterval(() => {
      const storedTheme = readStoredTheme(getThemeStorage());
      setThemeState(resolveThemePreference({
        hour: new Date().getHours(),
        storedTheme,
      }));
    }, 60000);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      clearInterval(timer);
    };
  }, []);

  const setTheme = (nextTheme: ThemePreference) => {
    const storage = getThemeStorage();
    try {
      storage?.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage failures and keep the in-memory preference for this session.
    }
    // 立即解析并应用主题
    const resolvedTheme = nextTheme === "auto" ? getSystemTheme() : nextTheme;
    setThemeState(resolvedTheme);
  };

  return { theme, setTheme };
}
