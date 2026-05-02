import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface ToolResultCardProps {
  toolName: string;
  result: {
    success: boolean;
    data?: unknown;
    error?: string;
  };
  timestamp: Date;
}

export function ToolResultCard({ toolName, result, timestamp }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(true);

  const formatData = (data: unknown): string => {
    if (typeof data === "string") {
      return data;
    }
    if (data === null || data === undefined) {
      return "";
    }
    return JSON.stringify(data, null, 2);
  };

  return (
    <div className={`border rounded-lg p-4 ${
      result.success
        ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
        : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
    }`}>
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <h3 className="font-medium">{toolName} 结果</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {timestamp.toLocaleTimeString()}
        </span>
      </div>

      {expanded && (
        <div className="mt-3">
          {result.success ? (
            <pre className="text-sm bg-white dark:bg-gray-900 p-3 rounded overflow-auto max-h-96 border">
              {formatData(result.data)}
            </pre>
          ) : (
            <div className="text-sm text-red-600 dark:text-red-400 font-medium">
              {result.error || "未知错误"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
