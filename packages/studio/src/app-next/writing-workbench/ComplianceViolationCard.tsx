import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ComplianceViolation {
  presetId: string;
  presetName: string;
  rule: string;
  violation: string;
  severity: "warning" | "error";
}

interface Props {
  violations: ComplianceViolation[];
  onDismiss: () => void;
}

export function ComplianceViolationCard({ violations, onDismiss }: Props) {
  if (violations.length === 0) return null;

  return (
    <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-orange-600" />
        <span className="text-sm font-medium text-orange-800 dark:text-orange-200">
          预设合规检查：{violations.length} 项违规
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={onDismiss}>
          忽略全部
        </Button>
      </div>
      {violations.slice(0, 5).map((v, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <Badge variant="outline" className="text-[10px] shrink-0">
            {v.presetName}
          </Badge>
          <div className="flex-1">
            <div className="text-muted-foreground">{v.rule}</div>
            <div className="text-orange-700 dark:text-orange-300">{v.violation}</div>
          </div>
        </div>
      ))}
      {violations.length > 5 && (
        <div className="text-[10px] text-muted-foreground">还有 {violations.length - 5} 项...</div>
      )}
    </div>
  );
}
