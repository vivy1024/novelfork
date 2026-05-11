import { useState, useCallback } from "react";
import { useApi } from "../../../hooks/use-api";
import { InlineError } from "../../components/feedback";
import { Button } from "@/components/ui/button";

interface UsageEntry {
  providerId: string;
  providerName?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  sessionCount: number;
}

interface UsageSummary {
  entries: UsageEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTurns: number;
  totalSessions: number;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function UsagePanel() {
  const { data, loading, error, refetch } = useApi<UsageSummary>("/usage/summary");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-2 text-foreground">使用历史</h2>
          <p className="text-sm text-muted-foreground">
            按提供商和模型分组的 Token 使用统计，数据来自所有会话的累计用量。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "刷新中..." : "刷新"}
        </Button>
      </div>

      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-xs text-muted-foreground">输入 Tokens</div>
              <div className="text-lg font-mono font-semibold text-foreground">{formatTokenCount(data.totalInputTokens)}</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-xs text-muted-foreground">输出 Tokens</div>
              <div className="text-lg font-mono font-semibold text-foreground">{formatTokenCount(data.totalOutputTokens)}</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-xs text-muted-foreground">总轮次</div>
              <div className="text-lg font-mono font-semibold text-foreground">{data.totalTurns}</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-xs text-muted-foreground">会话数</div>
              <div className="text-lg font-mono font-semibold text-foreground">{data.totalSessions}</div>
            </div>
          </div>

          {/* Usage table */}
          {data.entries.length === 0 ? (
            <div className="rounded-lg border border-border p-6 text-center text-muted-foreground">
              暂无用量数据。开始会话后，Token 使用统计将在此显示。
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">提供商</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">模型</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">输入</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">输出</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">总计</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">轮次</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">会话</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={`${entry.providerId}::${entry.modelId}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 text-foreground">{entry.providerName || entry.providerId || "—"}</td>
                      <td className="px-4 py-2 font-mono text-foreground">{entry.modelId || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground">{formatTokenCount(entry.inputTokens)}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground">{formatTokenCount(entry.outputTokens)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{formatTokenCount(entry.inputTokens + entry.outputTokens)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{entry.turnCount}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{entry.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
