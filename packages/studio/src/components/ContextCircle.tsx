/**
 * ContextCircle — SVG progress circle showing context token usage
 */

import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";

interface ContextUsage {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly percentage: number;
  readonly messages: number;
  readonly canCompress: boolean;
}

interface ContextCircleProps {
  readonly bookId: string;
  readonly onCompress?: () => void;
  readonly onTruncate?: () => void;
  readonly onClear?: () => void;
}

function getColor(percentage: number): string {
  if (percentage < 60) return "#10b981"; // emerald-500
  if (percentage < 80) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

export function ContextCircle({ bookId, onCompress, onTruncate, onClear }: ContextCircleProps) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const fetchUsage = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<ContextUsage>(`/api/context/${bookId}/usage`);
      setUsage(data);
    } catch (e) {
      console.error("Failed to fetch context usage:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [bookId]);

  if (!usage) return null;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (usage.percentage / 100) * circumference;
  const color = getColor(usage.percentage);

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="relative flex items-center justify-center w-24 h-24 rounded-full hover:bg-secondary/50 transition-colors"
        title="上下文管理"
      >
        <svg width="100" height="100" className="transform -rotate-90">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-secondary"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-300"
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-bold" style={{ color }}>
            {Math.round(usage.percentage)}%
          </span>
          <span className="text-[10px] text-muted-foreground">
            {(usage.totalTokens / 1000).toFixed(0)}k
          </span>
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-full">
            <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </button>

      {/* Context menu */}
      {showMenu && (
        <div className="absolute top-full mt-2 right-0 w-48 bg-background border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <button
            onClick={() => {
              onCompress?.();
              setShowMenu(false);
            }}
            disabled={!usage.canCompress}
            className="w-full px-4 py-2 text-left text-sm hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            压缩上下文
          </button>
          <button
            onClick={() => {
              onTruncate?.();
              setShowMenu(false);
            }}
            className="w-full px-4 py-2 text-left text-sm hover:bg-secondary"
          >
            裁剪上下文
          </button>
          <button
            onClick={() => {
              if (confirm("确定要清空所有上下文吗？此操作不可恢复。")) {
                onClear?.();
                setShowMenu(false);
              }
            }}
            className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            清空上下文
          </button>
        </div>
      )}
    </div>
  );
}
