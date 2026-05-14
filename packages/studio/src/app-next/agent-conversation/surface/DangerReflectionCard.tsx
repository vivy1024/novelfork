import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface DangerReflection {
  id: string;
  toolName: string;
  command: string;
  analysis: string;
  riskFactors: string[];
}

interface Props {
  reflection: DangerReflection;
  onDecision: (id: string, decision: "proceed" | "abort") => void;
}

export function DangerReflectionCard({ reflection, onDecision }: Props) {
  const [decided, setDecided] = useState<"proceed" | "abort" | null>(null);

  const handleDecision = (decision: "proceed" | "abort") => {
    setDecided(decision);
    onDecision(reflection.id, decision);
  };

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${decided ? "opacity-60" : "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"}`}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-red-500 shrink-0" />
        <span className="text-sm font-medium text-red-700 dark:text-red-300">危险操作反思</span>
        <Badge variant="secondary" className="text-[11px] font-mono">
          {reflection.toolName}
        </Badge>
      </div>

      <pre className="text-xs bg-muted/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono">
        {reflection.command}
      </pre>

      <p className="text-xs text-muted-foreground leading-relaxed">
        {reflection.analysis}
      </p>

      {reflection.riskFactors.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {reflection.riskFactors.map((factor) => (
            <Badge
              key={factor}
              variant="secondary"
              className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            >
              {factor}
            </Badge>
          ))}
        </div>
      )}

      {decided ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {decided === "proceed" ? (
            <>
              <Check className="size-3 text-orange-500" />
              <span>已确认执行</span>
            </>
          ) : (
            <>
              <X className="size-3 text-gray-500" />
              <span>已中止</span>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs bg-orange-600 hover:bg-orange-700 text-white"
            onClick={() => handleDecision("proceed")}
          >
            <Check className="size-3 mr-1" />
            确认执行
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => handleDecision("abort")}
          >
            <X className="size-3 mr-1" />
            中止
          </Button>
        </div>
      )}
    </div>
  );
}
