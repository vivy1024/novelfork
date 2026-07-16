import { fetchJson } from "@/hooks/use-api";

export type ScheduledTaskRunContext = "standalone" | "chapter";
export type ScheduledTaskNarratorMode = "new" | "reuse";
export type ScheduledTaskLocale = "en" | "zh-CN";
export type ScheduledTaskStatus = "success" | "failed" | "skipped";
export type ScheduledTaskPermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "readOnly"
  | "dontAsk";

export interface ScheduledTask {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly cronExpr: string;
  readonly timezone: string | null;
  readonly prompt: string;
  readonly systemPrompt: string | null;
  readonly model: string | null;
  readonly permissionMode: ScheduledTaskPermissionMode;
  readonly locale: ScheduledTaskLocale;
  readonly runContext: ScheduledTaskRunContext;
  readonly cwd: string | null;
  readonly projectId: string | null;
  readonly chapterId: string | null;
  readonly narratorMode: ScheduledTaskNarratorMode;
  readonly reuseNarratorId: string | null;
  readonly createdBy: string | null;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly lastNarratorId: string | null;
  readonly lastStatus: ScheduledTaskStatus | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduledTaskInput {
  readonly name: string;
  readonly cronExpr: string;
  readonly timezone?: string | null;
  readonly prompt: string;
  readonly systemPrompt?: string | null;
  readonly model?: string | null;
  readonly permissionMode?: ScheduledTaskPermissionMode;
  readonly locale?: ScheduledTaskLocale;
  readonly runContext?: ScheduledTaskRunContext;
  readonly cwd?: string | null;
  readonly projectId?: string | null;
  readonly chapterId?: string | null;
  readonly narratorMode?: ScheduledTaskNarratorMode;
  readonly enabled?: boolean;
}

export interface ScheduledTaskRun {
  readonly id: string;
  readonly taskId: string;
  readonly narratorId: string | null;
  readonly status: ScheduledTaskStatus;
  readonly error: string | null;
  readonly runContext: ScheduledTaskRunContext;
  readonly manual: boolean;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
}

export interface ScheduledTaskRunsPage {
  readonly runs: readonly ScheduledTaskRun[];
  readonly nextCursor: string | null;
}

const BASE_PATH = "/api/scheduled-tasks";
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function taskPath(id: string): string {
  return `${BASE_PATH}/${encodeURIComponent(id)}`;
}

export const scheduledTasksClient = {
  list(): Promise<ScheduledTask[]> {
    return fetchJson<ScheduledTask[]>(BASE_PATH);
  },

  get(id: string): Promise<ScheduledTask> {
    return fetchJson<ScheduledTask>(taskPath(id));
  },

  create(input: ScheduledTaskInput): Promise<ScheduledTask> {
    return fetchJson<ScheduledTask>(BASE_PATH, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
  },

  update(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask> {
    return fetchJson<ScheduledTask>(taskPath(id), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
  },

  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return fetchJson<ScheduledTask>(`${taskPath(id)}/toggle`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled }),
    });
  },

  runNow(id: string): Promise<ScheduledTask> {
    return fetchJson<ScheduledTask>(`${taskPath(id)}/run`, { method: "POST" });
  },

  listRuns(id: string, options: { readonly limit?: number; readonly cursor?: string | null } = {}): Promise<ScheduledTaskRunsPage> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor) params.set("cursor", options.cursor);
    const query = params.toString();
    return fetchJson<ScheduledTaskRunsPage>(`${taskPath(id)}/runs${query ? `?${query}` : ""}`);
  },

  delete(id: string): Promise<{ ok: boolean }> {
    return fetchJson<{ ok: boolean }>(taskPath(id), { method: "DELETE" });
  },
};
