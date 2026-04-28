import { AlertTriangle, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import type { RuntimeCapabilityStatus } from "../../lib/runtime-capabilities";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABELS: Record<RuntimeCapabilityStatus, string> = {
  planned: "规划中",
  unavailable: "当前不可用",
  disabled: "已禁用",
  "not-configured": "未配置",
};

export function UnsupportedCapability({
  title,
  reason,
  status = "planned",
  capability,
  docsHref,
  children,
}: {
  readonly title: string;
  readonly reason: string;
  readonly status?: RuntimeCapabilityStatus;
  readonly capability?: string;
  readonly docsHref?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Card className="border-dashed border-border/80 bg-muted/20">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base" role="heading" aria-level={3}>
              <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />
              {title}
            </CardTitle>
            <CardDescription>{reason}</CardDescription>
          </div>
          <Badge variant="outline">{STATUS_LABELS[status]}</Badge>
        </div>
      </CardHeader>
      {(capability || docsHref || children) && (
        <CardContent className="space-y-3 pt-0 text-sm text-muted-foreground">
          {capability && (
            <div className="flex flex-wrap items-center gap-2">
              <span>能力标识</span>
              <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">{capability}</code>
            </div>
          )}
          {children}
          {docsHref && (
            <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={docsHref}>
              查看说明
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </CardContent>
      )}
    </Card>
  );
}
