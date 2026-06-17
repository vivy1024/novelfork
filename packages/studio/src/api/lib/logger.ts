/**
 * Structured Logger — NarraFork-aligned log format.
 *
 * Output format: {"ts":"ISO","level":"info|warn|error","msg":"human summary",...fields}
 *
 * Replaces scattered console.log(JSON.stringify({component, event, ...})) calls
 * with a consistent, grep-friendly format that includes timestamps and levels.
 */

type LogLevel = "info" | "warn" | "error";

function formatLog(level: LogLevel, msg: string, fields?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) {
        entry[k] = v;
      }
    }
  }
  return JSON.stringify(entry);
}

export const log = {
  info(msg: string, fields?: Record<string, unknown>): void {
    console.log(formatLog("info", msg, fields));
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    console.warn(formatLog("warn", msg, fields));
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    console.error(formatLog("error", msg, fields));
  },
};
