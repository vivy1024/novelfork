export type StartupLogLevel = "info" | "warn" | "error";

export interface StartupLogEvent {
  readonly level: StartupLogLevel;
  readonly component: string;
  readonly msg: string;
  readonly ok?: boolean;
  readonly skipped?: boolean;
  readonly reason?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface StartupLogCounts {
  readonly ok: number;
  readonly skipped: number;
  readonly failed: number;
}

export type StartupLogSink = (line: string) => void;

export function logStartupEvent(event: StartupLogEvent, sink: StartupLogSink = console.log): void {
  sink(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: event.level,
    component: event.component,
    msg: event.msg,
    ...(event.ok !== undefined ? { ok: event.ok } : {}),
    ...(event.skipped !== undefined ? { skipped: event.skipped } : {}),
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.extra ?? {}),
  }));
}

export function summarizeStartupEvents(events: ReadonlyArray<StartupLogEvent>): StartupLogCounts {
  return events.reduce<StartupLogCounts>((counts, event) => ({
    ok: counts.ok + (event.ok === true ? 1 : 0),
    skipped: counts.skipped + (event.skipped === true ? 1 : 0),
    failed: counts.failed + (event.ok === false ? 1 : 0),
  }), { ok: 0, skipped: 0, failed: 0 });
}
