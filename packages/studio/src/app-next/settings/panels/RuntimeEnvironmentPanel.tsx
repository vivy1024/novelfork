import { useState, useCallback } from "react";
import { useApi } from "../../../hooks/use-api";
import { InlineError } from "../../components/feedback";
import { Button } from "@/components/ui/button";

interface RuntimeCheck {
  name: string;
  status: "ok" | "unavailable";
  version?: string;
  error?: string;
}

interface RuntimeStatusData {
  checks: RuntimeCheck[];
}

function statusIcon(status: "ok" | "unavailable") {
  if (status === "ok") {
    return <span className="inline-block w-2 h-2 rounded-full bg-green-500" />;
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-red-500" />;
}

export function RuntimeEnvironmentPanel() {
  const { data, loading, error, refetch } = useApi<RuntimeStatusData>("/runtime/status");
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
          <h2 className="text-lg font-semibold mb-2 text-foreground">运行时环境</h2>
          <p className="text-sm text-muted-foreground">
            检查 Git、终端、运行时版本与操作系统信息。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "检查中..." : "重新检查"}
        </Button>
      </div>

      {loading && <p className="text-muted-foreground">检查中...</p>}
      {error && <InlineError message={error} />}

      {data && (
        <div className="space-y-3">
          {data.checks.length === 0 ? (
            <div className="rounded-lg border border-border p-6 text-center text-muted-foreground">
              无运行时检查结果。
            </div>
          ) : (
            data.checks.map((check) => (
              <div key={check.name} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {statusIcon(check.status)}
                    <span className="font-medium text-foreground">{check.name}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    check.status === "ok"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                  }`}>
                    {check.status === "ok" ? "可用" : "不可用"}
                  </span>
                </div>
                {check.version && (
                  <p className="mt-2 text-sm font-mono text-muted-foreground pl-5">{check.version}</p>
                )}
                {check.error && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400 pl-5">{check.error}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
