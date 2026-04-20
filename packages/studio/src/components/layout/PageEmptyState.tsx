import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { Card, CardContent } from "../ui/card";

interface PageEmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly icon?: LucideIcon;
}

export function PageEmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: PageEmptyStateProps) {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border/70">
          <Icon className="size-5" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-foreground">{title}</h2>
          {description && <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
