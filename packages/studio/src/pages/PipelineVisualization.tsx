import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { fetchJson } from "../hooks/use-api";

interface PipelineStage {
  readonly name: string;
  readonly status: "waiting" | "running" | "completed" | "failed";
  readonly agent?: string;
  readonly model?: string;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly toolCalls?: ReadonlyArray<{
    readonly name: string;
    readonly timestamp: number;
    readonly duration?: number;
    readonly result?: string;
  }>;
  readonly error?: string;
}

interface PipelineRun {
  readonly runId: string;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly status: "running" | "completed" | "failed";
  readonly startTime: number;
  readonly endTime?: number;
  readonly stages: ReadonlyArray<PipelineStage>;
}

const STAGE_NAMES = [
  { key: "plan", label: "Plan", description: "生成章节意图" },
  { key: "compose", label: "Compose", description: "组装上下文和规则栈" },
  { key: "write", label: "Write", description: "生成章节正文" },
  { key: "normalize", label: "Normalize", description: "长度治理和格式化" },
  { key: "settle", label: "Settle", description: "持久化状态和伏笔" },
  { key: "audit", label: "Audit", description: "审计连续性和质量" },
  { key: "revise", label: "Revise", description: "修订问题" },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

function StageCard({ stage }: { stage: PipelineStage }) {
  const duration = stage.startTime && stage.endTime
    ? stage.endTime - stage.startTime
    : stage.startTime
    ? Date.now() - stage.startTime
    : 0;

  const statusColors = {
    waiting: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-foreground">{stage.name}</h3>
        <Badge className={statusColors[stage.status]}>
          {stage.status}
        </Badge>
      </div>

      {stage.agent && (
        <div className="text-sm text-muted-foreground mb-1">
          Agent: <span className="font-mono">{stage.agent}</span>
        </div>
      )}

      {stage.model && (
        <div className="text-sm text-muted-foreground mb-1">
          Model: <span className="font-mono">{stage.model}</span>
        </div>
      )}

      {duration > 0 && (
        <div className="text-sm text-muted-foreground mb-1">
          Duration: {formatDuration(duration)}
        </div>
      )}

      {stage.tokenUsage && (
        <div className="text-sm text-muted-foreground mb-2">
          Tokens: {formatTokens(stage.tokenUsage.totalTokens)}
          <span className="text-xs ml-1">
            ({formatTokens(stage.tokenUsage.promptTokens)} + {formatTokens(stage.tokenUsage.completionTokens)})
          </span>
        </div>
      )}

      {stage.toolCalls && stage.toolCalls.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-1">Tool Calls:</div>
          <div className="space-y-1">
            {stage.toolCalls.map((call, idx) => (
              <div key={idx} className="text-xs font-mono text-muted-foreground">
                {call.name}
                {call.duration && ` (${formatDuration(call.duration)})`}
              </div>
            ))}
          </div>
        </div>
      )}

      {stage.error && (
        <div className="mt-2 p-2 bg-red-50 dark:bg-red-950 rounded text-xs text-red-700 dark:text-red-300">
          {stage.error}
        </div>
      )}
    </Card>
  );
}

export function PipelineVisualization({
  runId,
  nav,
  theme,
  t
}: {
  runId?: string;
  nav: any;
  theme: any;
  t: any;
}) {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }

    const fetchRun = async () => {
      try {
        const data = await fetchJson<PipelineRun>(`/api/pipeline/${runId}/status`);
        setRun(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load pipeline run");
      } finally {
        setLoading(false);
      }
    };

    fetchRun();

    // Poll for updates if running
    const interval = setInterval(() => {
      if (run?.status === "running") {
        fetchRun();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runId, run?.status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-serif mb-4">Pipeline Visualization</h2>
        <p className="text-muted-foreground">No pipeline run selected</p>
      </div>
    );
  }

  const totalDuration = run.endTime ? run.endTime - run.startTime : Date.now() - run.startTime;
  const totalTokens = run.stages.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif mb-2">Pipeline Run</h1>
        <p className="text-muted-foreground">
          {run.bookTitle} - Run ID: {run.runId}
        </p>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Status</div>
            <div className="text-lg font-medium">{run.status}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Duration</div>
            <div className="text-lg font-medium">{formatDuration(totalDuration)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Total Tokens</div>
            <div className="text-lg font-medium">{formatTokens(totalTokens)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Stages</div>
            <div className="text-lg font-medium">
              {run.stages.filter(s => s.status === "completed").length} / {run.stages.length}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {run.stages.map((stage, idx) => (
          <div key={idx} onClick={() => setSelectedStage(stage)} className="cursor-pointer">
            <StageCard stage={stage} />
          </div>
        ))}
      </div>

      {selectedStage && (
        <Card className="p-6">
          <h2 className="text-xl font-serif mb-4">Stage Details: {selectedStage.name}</h2>
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Status</div>
              <div>{selectedStage.status}</div>
            </div>
            {selectedStage.agent && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Agent</div>
                <div className="font-mono">{selectedStage.agent}</div>
              </div>
            )}
            {selectedStage.model && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Model</div>
                <div className="font-mono">{selectedStage.model}</div>
              </div>
            )}
            {selectedStage.toolCalls && selectedStage.toolCalls.length > 0 && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">Tool Calls</div>
                <div className="space-y-2">
                  {selectedStage.toolCalls.map((call, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded">
                      <div className="font-mono text-sm">{call.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(call.timestamp).toLocaleTimeString()}
                        {call.duration && ` - ${formatDuration(call.duration)}`}
                      </div>
                      {call.result && (
                        <pre className="mt-2 text-xs overflow-x-auto">{call.result}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
