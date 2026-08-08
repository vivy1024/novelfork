import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ToolResultSurfaceProps {
  readonly testId: string;
  readonly title: ReactNode;
  readonly icon?: ReactNode;
  readonly meta?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
}

/** NovelFork 工具结果的统一 Nova 紧凑表面，强制使用 shadcn Card 完整组合。 */
export function ToolResultSurface({
  testId,
  title,
  icon,
  meta,
  children,
  footer,
  className,
  contentClassName,
}: ToolResultSurfaceProps) {
  return (
    <Card data-slot="tool-result-surface" data-testid={testId} size="sm" className={className}>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="min-w-0">{title}</span>
        </CardTitle>
        {meta && <CardAction className="text-xs text-muted-foreground">{meta}</CardAction>}
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-2", contentClassName)}>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}
