import type { Theme } from "./use-theme";

export interface ThemeColors {
  readonly bg: string;
  readonly bgSecondary: string;
  readonly text: string;
  readonly border: string;
  readonly accent: string;
  readonly muted: string;
  readonly surface: string;
  readonly cardStatic: string;
}

const LIGHT_COLORS: ThemeColors = {
  bg: "#ffffff",
  bgSecondary: "#f8fafc",
  text: "#0f172a",
  border: "#e2e8f0",
  accent: "#2563eb",
  muted: "text-slate-500",
  surface: "bg-white",
  cardStatic: "border-slate-200 bg-white",
};

const DARK_COLORS: ThemeColors = {
  bg: "#0f172a",
  bgSecondary: "#1e293b",
  text: "#f8fafc",
  border: "#334155",
  accent: "#60a5fa",
  muted: "text-slate-400",
  surface: "bg-slate-900",
  cardStatic: "border-slate-700 bg-slate-900",
};

export function useColors(theme: Theme): ThemeColors {
  return theme === "dark" ? DARK_COLORS : LIGHT_COLORS;
}
