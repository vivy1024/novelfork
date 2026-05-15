import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lightbulb, Check, X } from "lucide-react";

export interface PresetSuggestion {
  presetId: string;
  presetName: string;
  action: "enable" | "disable" | "adjust";
  reason: string;
  confidence: number;
}

interface Props {
  suggestions: PresetSuggestion[];
  onAccept: (suggestion: PresetSuggestion) => void;
  onDismiss: (suggestion: PresetSuggestion) => void;
  onDismissAll: () => void;
}

export function PresetSuggestionCard({ suggestions, onAccept, onDismiss, onDismissAll }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 text-amber-600" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">预设建议</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={onDismissAll}>
          全部忽略
        </Button>
      </div>
      {suggestions.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <Badge
            variant={s.action === "enable" ? "default" : s.action === "disable" ? "destructive" : "secondary"}
            className="text-[10px]"
          >
            {s.action === "enable" ? "启用" : s.action === "disable" ? "禁用" : "调整"}
          </Badge>
          <span className="font-medium">{s.presetName}</span>
          <span className="text-muted-foreground flex-1 truncate">{s.reason}</span>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => onAccept(s)}>
            <Check className="size-3 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => onDismiss(s)}>
            <X className="size-3 text-muted-foreground" />
          </Button>
        </div>
      ))}
    </div>
  );
}
