export type Theme = "light" | "dark" | "auto";

export function useTheme(initialTheme: Theme = "light") {
  return {
    theme: initialTheme,
    resolvedTheme: initialTheme === "auto" ? "light" : initialTheme,
    setTheme: () => {},
    toggleTheme: () => {},
  } as const;
}
