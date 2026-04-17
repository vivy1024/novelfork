import { useState } from "react";
import { Copy, RotateCw, CheckCircle2 } from "lucide-react";
import type { ToolCall } from "../../stores/windowStore";
import { ToolIcon } from "./ToolIcon";
import { ToolCallOutput } from "./ToolCallOutput";

interface ToolCallCardProps {
  toolCall: ToolCall;
  theme: {
    text: string;
    textSecondary: string;
    bg: string;
    bgSecondary: string;
    border: string;
    accent: string;
  };
}

export function ToolCallCard({ toolCall, theme }: ToolCallCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(toolCall.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRerun = () => {
    // TODO: 实现重新运行功能
    console.log("Rerun:", toolCall.command);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div
      className="rounded-lg p-3 space-y-2 text-sm"
      style={{
        backgroundColor: theme.bgSecondary,
        border: `1px solid ${theme.border}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ToolIcon name={toolCall.toolName} size={16} color={theme.accent} />
          <span className="font-medium" style={{ color: theme.text }}>
            {toolCall.toolName}
          </span>
          {toolCall.exitCode !== undefined && toolCall.exitCode !== 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: "#fef2f2",
                color: "#dc2626",
              }}
            >
              Exit {toolCall.exitCode}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: theme.textSecondary }}>
          {formatDuration(toolCall.duration)}
        </span>
      </div>

      {/* Command */}
      {toolCall.command && (
        <pre
          className="text-xs p-2 rounded overflow-x-auto font-mono"
          style={{
            backgroundColor: theme.bg,
            color: theme.text,
            border: `1px solid ${theme.border}`,
          }}
        >
          {toolCall.command}
        </pre>
      )}

      {/* Output */}
      <ToolCallOutput
        output={toolCall.output}
        error={toolCall.error}
        theme={theme}
      />

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: theme.bg,
            color: theme.text,
            border: `1px solid ${theme.border}`,
          }}
        >
          {copied ? (
            <>
              <CheckCircle2 size={12} />
              已复制
            </>
          ) : (
            <>
              <Copy size={12} />
              复制
            </>
          )}
        </button>
        <button
          onClick={handleRerun}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: theme.bg,
            color: theme.text,
            border: `1px solid ${theme.border}`,
          }}
        >
          <RotateCw size={12} />
          重新运行
        </button>
      </div>
    </div>
  );
}
