import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ToolCallOutputProps {
  output: string;
  error?: string;
  theme: {
    text: string;
    textSecondary: string;
    bgSecondary: string;
    border: string;
  };
}

export function ToolCallOutput({ output, error, theme }: ToolCallOutputProps) {
  const [collapsed, setCollapsed] = useState(output.length > 500);
  const displayOutput = collapsed ? output.slice(0, 500) : output;

  return (
    <div className="space-y-2">
      {output && (
        <div>
          <pre
            className="text-xs p-2 rounded overflow-x-auto font-mono"
            style={{
              backgroundColor: theme.bgSecondary,
              color: theme.textSecondary,
              border: `1px solid ${theme.border}`,
            }}
          >
            {displayOutput}
            {collapsed && "..."}
          </pre>
          {output.length > 500 && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="flex items-center gap-1 text-xs mt-1 px-2 py-1 rounded hover:opacity-80 transition-opacity"
              style={{ color: theme.text }}
            >
              {collapsed ? (
                <>
                  <ChevronDown size={14} />
                  显示剩余 {output.length - 500} 个字符
                </>
              ) : (
                <>
                  <ChevronUp size={14} />
                  收起
                </>
              )}
            </button>
          )}
        </div>
      )}
      {error && (
        <pre
          className="text-xs p-2 rounded overflow-x-auto font-mono"
          style={{
            backgroundColor: "#fef2f2",
            color: "#dc2626",
            border: "1px solid #fecaca",
          }}
        >
          {error}
        </pre>
      )}
    </div>
  );
}
