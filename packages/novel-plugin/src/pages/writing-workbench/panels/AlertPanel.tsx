import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, BookOpen, Wind, CheckCircle2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertItem {
  readonly id: string;
  readonly type: "audit" | "hook" | "drift";
  readonly description: string;
}

interface HealthResponse {
  readonly health: {
    readonly warnings?: readonly { type: string; message: string }[];
    readonly chapters?: readonly {
      chapterNumber: number;
      auditStatus: "pass" | "warn" | "none";
    }[];
  };
}

export interface AlertPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// Mock overdue hooks (cockpit.list_open_hooks concept)
// ---------------------------------------------------------------------------

// Mock data removed — alerts come only from real API data

// ---------------------------------------------------------------------------
// Icons per type
// ---------------------------------------------------------------------------

const ALERT_ICONS: Record<string, typeof AlertTriangle> = {
  audit: AlertTriangle,
  hook: BookOpen,
  drift: Wind,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlertPanel({ bookId }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/books/${bookId}/health`)
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        const collected: AlertItem[] = [];

        // Audit failures
        const chapters = data.health.chapters ?? [];
        const failedChapters = chapters.filter((c) => c.auditStatus === "warn");
        for (const ch of failedChapters) {
          collected.push({
            id: `audit-${ch.chapterNumber}`,
            type: "audit",
            description: `第${ch.chapterNumber}章审校未通过`,
          });
        }

        // Warnings from health (style drift etc.)
        const warnings = data.health.warnings ?? [];
        for (const w of warnings) {
          collected.push({
            id: `warn-${w.type}-${w.message.slice(0, 20)}`,
            type: "drift",
            description: w.message,
          });
        }

        setAlerts(collected);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setAlerts([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <CheckCircle2 className="size-8 text-green-500/70" />
        <p className="text-sm text-muted-foreground">一切正常 ✅</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {alerts.map((alert) => {
        const Icon = ALERT_ICONS[alert.type] ?? AlertTriangle;
        return (
          <div
            key={alert.id}
            className={cn(
              "flex items-center gap-2 rounded-md border p-2",
              alert.type === "audit" && "border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20",
              alert.type === "hook" && "border-yellow-200 bg-yellow-50 dark:border-yellow-900/30 dark:bg-yellow-950/20",
              alert.type === "drift" && "border-orange-200 bg-orange-50 dark:border-orange-900/30 dark:bg-orange-950/20"
            )}
          >
            <Icon className={cn(
              "size-4 shrink-0",
              alert.type === "audit" && "text-red-500",
              alert.type === "hook" && "text-yellow-600",
              alert.type === "drift" && "text-orange-500"
            )} />
            <span className="text-xs flex-1 min-w-0 truncate">{alert.description}</span>
            <Button variant="ghost" size="icon" className="size-6 shrink-0">
              <Eye className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
