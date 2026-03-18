import type { Theme } from "./use-theme";

// Semantic color tokens — now uses CSS variables via shadcn theme
// No more light/dark branching — handled by .dark class on <html>
export function useColors(_theme: Theme) {
  return {
    card: "border-border hover:border-ring/40 transition-colors",
    cardStatic: "border-border",
    surface: "bg-card",
    muted: "text-muted-foreground",
    subtle: "text-muted-foreground",
    link: "hover:text-foreground transition-colors cursor-pointer",
    input: "bg-background border border-input text-foreground focus:border-ring focus:ring-1 focus:ring-ring/30 transition-colors",
    btnPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors",
    btnSecondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70 transition-colors",
    btnSuccess: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors",
    btnDanger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 transition-colors",
    tableHeader: "bg-muted text-muted-foreground",
    tableDivide: "divide-border",
    tableHover: "hover:bg-muted/50 transition-colors",
    error: "border-destructive/50 bg-destructive/10 text-destructive",
    info: "border-ring/50 bg-primary/10 text-primary",
    code: "bg-muted text-muted-foreground",
    active: "text-emerald-500",
    paused: "text-amber-500",
    mono: "font-mono text-sm",
    accent: "text-primary",
  };
}
