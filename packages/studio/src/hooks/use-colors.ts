import type { Theme } from "./use-theme";

export function useColors(theme: Theme) {
  const d = theme === "dark";
  return {
    card: d ? "border-zinc-700 hover:border-zinc-600 transition-colors" : "border-zinc-200 hover:border-zinc-400 transition-colors",
    cardStatic: d ? "border-zinc-700" : "border-zinc-200",
    surface: d ? "bg-zinc-900" : "bg-white",
    muted: d ? "text-zinc-500" : "text-zinc-400",
    subtle: d ? "text-zinc-400" : "text-zinc-500",
    link: d ? "hover:text-white transition-colors cursor-pointer" : "hover:text-zinc-900 transition-colors cursor-pointer",
    input: d
      ? "bg-zinc-800 border border-zinc-600 text-zinc-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
      : "bg-white border border-zinc-300 text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors",
    btnPrimary: d
      ? "bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 transition-colors"
      : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-colors",
    btnSecondary: d
      ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 active:bg-zinc-600 transition-colors"
      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900 active:bg-zinc-300 transition-colors",
    btnSuccess: d
      ? "bg-emerald-700 text-emerald-100 hover:bg-emerald-600 active:bg-emerald-800 transition-colors"
      : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 transition-colors",
    btnDanger: d
      ? "bg-red-800 text-red-100 hover:bg-red-700 active:bg-red-900 transition-colors"
      : "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 transition-colors",
    tableHeader: d ? "bg-zinc-900 text-zinc-400" : "bg-zinc-50 text-zinc-500",
    tableDivide: d ? "divide-zinc-700" : "divide-zinc-200",
    tableHover: d ? "hover:bg-zinc-800/50 transition-colors" : "hover:bg-zinc-50 transition-colors",
    error: d ? "border-red-700 bg-red-950/40 text-red-300" : "border-red-200 bg-red-50 text-red-700",
    info: d ? "border-blue-700 bg-blue-950/40 text-blue-300" : "border-blue-200 bg-blue-50 text-blue-700",
    code: d ? "bg-zinc-800 text-zinc-300" : "bg-zinc-100 text-zinc-700",
    active: "text-emerald-400",
    paused: "text-amber-400",
    mono: "font-mono text-sm",
    accent: d ? "text-blue-400" : "text-blue-600",
  };
}
