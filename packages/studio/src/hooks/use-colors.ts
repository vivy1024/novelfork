import type { Theme } from "./use-theme";

export function useColors(_theme: Theme) {
  return {
    card: "border-border/60 hover:border-primary/30 transition-all duration-200",
    cardStatic: "border-border/60",
    surface: "bg-card",
    muted: "text-muted-foreground",
    subtle: "text-muted-foreground",
    link: "hover:text-primary transition-colors cursor-pointer",
    input: "bg-input/30 border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all duration-200",
    btnPrimary: "bg-primary text-primary-foreground hover:opacity-90 active:opacity-80 transition-opacity",
    btnSecondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors",
    btnSuccess: "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors",
    btnDanger: "bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity",
    tableHeader: "bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider",
    tableDivide: "divide-border/60",
    tableHover: "hover:bg-muted/30 transition-colors",
    error: "border-destructive/30 bg-destructive/5 text-destructive",
    info: "border-primary/20 bg-primary/5 text-primary",
    code: "bg-muted text-muted-foreground font-mono text-sm",
    active: "text-emerald-500",
    paused: "text-amber-500",
    mono: "font-mono text-sm",
    accent: "text-primary",
  };
}
