import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageScaffoldProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
}

export function PageScaffold({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: PageScaffoldProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <header className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            NovelFork Studio
          </p>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description && (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>

      <div className={cn("space-y-6", contentClassName)}>{children}</div>
    </div>
  );
}
