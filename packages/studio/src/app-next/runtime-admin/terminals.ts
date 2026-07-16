import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export interface RuntimeTerminalProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
  readonly state: string;
  readonly rss: number;
  readonly cpu: number;
  readonly elapsed: string;
}

export interface RuntimeAdminTerminal {
  readonly id: string;
  readonly chapterId?: string | null;
  readonly narratorId?: string | null;
  readonly name: string;
  readonly cwd?: string | null;
  readonly dtachSocket?: string | null;
  readonly deviceId?: string | null;
  readonly status: "running" | "exited";
  readonly exitCode?: number | null;
  readonly createdAt: string;
  readonly attached: boolean;
  readonly processes: readonly RuntimeTerminalProcess[];
}

export interface RuntimeOrphanTerminalSocket {
  readonly socketPath: string;
  readonly terminalId: string;
}

export interface RuntimeAdminTerminalsResponse {
  readonly terminals: readonly RuntimeAdminTerminal[];
  readonly orphanSockets: readonly RuntimeOrphanTerminalSocket[];
}

export interface RuntimeBatchKillResult {
  readonly results: readonly {
    readonly id: string;
    readonly ok: boolean;
    readonly error?: string;
  }[];
}

export function createTerminalsAdminClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    list: () => request<RuntimeAdminTerminalsResponse>("/api/admin/terminals"),
    kill: (id: string) =>
      request<OkResponse>(`/api/admin/terminals/${encodePathSegment(id)}`, { method: "DELETE" }),
    batchKill: (ids: readonly string[]) =>
      request<RuntimeBatchKillResult>(
        "/api/admin/terminals/batch-kill",
        jsonRequest("POST", { ids }),
      ),
    killOrphan: (terminalId: string) =>
      request<OkResponse>(
        "/api/admin/terminals/kill-orphan",
        jsonRequest("POST", { terminalId }),
      ),
    reattach: (id: string) =>
      request<OkResponse>(
        `/api/admin/terminals/${encodePathSegment(id)}/reattach`,
        { method: "POST" },
      ),
    reattachOrphan: (terminalId: string) =>
      request<RuntimeAdminTerminal>(
        "/api/admin/terminals/reattach-orphan",
        jsonRequest("POST", { terminalId }),
      ),
  } as const;
}
