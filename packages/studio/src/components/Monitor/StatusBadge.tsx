import { Badge } from "../ui/badge";
import { CheckCircle2, Circle, AlertCircle, XCircle } from "lucide-react";
import type { MonitorStatus } from "./MonitorWidget";

interface StatusBadgeProps {
  status: MonitorStatus;
}

const statusConfig: Record<MonitorStatus, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: React.ComponentType<{ className?: string }>;
}> = {
  running: {
    label: "Running",
    variant: "default",
    icon: CheckCircle2,
  },
  stopped: {
    label: "Stopped",
    variant: "secondary",
    icon: Circle,
  },
  interrupted: {
    label: "Interrupted",
    variant: "outline",
    icon: AlertCircle,
  },
  error: {
    label: "Error",
    variant: "destructive",
    icon: XCircle,
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1.5">
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}
