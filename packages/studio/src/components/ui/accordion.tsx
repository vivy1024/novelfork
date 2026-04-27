import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface AccordionContextValue {
  readonly value?: string;
  readonly collapsible: boolean;
  readonly onToggle: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);
const AccordionItemContext = React.createContext<string | null>(null);

function Accordion({
  value,
  defaultValue,
  onValueChange,
  collapsible = false,
  className,
  children,
}: React.PropsWithChildren<{
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string | undefined) => void;
  readonly collapsible?: boolean;
  readonly className?: string;
}>) {
  const [internalValue, setInternalValue] = React.useState<string | undefined>(defaultValue);
  const currentValue = value ?? internalValue;

  const handleToggle = React.useCallback((nextValue: string) => {
    const resolved = currentValue === nextValue && collapsible ? undefined : nextValue;
    if (value === undefined) {
      setInternalValue(resolved);
    }
    onValueChange?.(resolved);
  }, [collapsible, currentValue, onValueChange, value]);

  return (
    <AccordionContext.Provider value={{ value: currentValue, collapsible, onToggle: handleToggle }}>
      <div className={cn("space-y-3", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

function AccordionItem({ value, className, children }: React.PropsWithChildren<{ readonly value: string; readonly className?: string }>) {
  return (
    <AccordionItemContext.Provider value={value}>
      <div className={cn("rounded-xl border border-border/60 bg-card", className)}>{children}</div>
    </AccordionItemContext.Provider>
  );
}

function AccordionTrigger({ className, children }: React.PropsWithChildren<{ readonly className?: string }>) {
  const accordion = React.useContext(AccordionContext);
  const itemValue = React.useContext(AccordionItemContext);
  if (!accordion || !itemValue) {
    throw new Error("AccordionTrigger must be used inside AccordionItem");
  }
  const open = accordion.value === itemValue;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => accordion.onToggle(itemValue)}
      className={cn(
        "flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40",
        className,
      )}
    >
      <span>{children}</span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
    </button>
  );
}

function AccordionContent({ className, children }: React.PropsWithChildren<{ readonly className?: string }>) {
  const accordion = React.useContext(AccordionContext);
  const itemValue = React.useContext(AccordionItemContext);
  if (!accordion || !itemValue) {
    throw new Error("AccordionContent must be used inside AccordionItem");
  }
  if (accordion.value !== itemValue) {
    return null;
  }

  return <div className={cn("border-t border-border/60 px-4 py-4", className)}>{children}</div>;
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
