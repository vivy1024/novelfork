/**
 * Turn Profiler — lightweight timing checkpoints for agent turns.
 *
 * Records named checkpoints with timestamps, then produces a summary
 * showing duration between each phase. Used for performance diagnosis.
 *
 * Usage:
 *   const profiler = createTurnProfiler(sessionId);
 *   profiler.checkpoint("generate_start");
 *   // ... do work ...
 *   profiler.checkpoint("generate_end");
 *   profiler.checkpoint("tool_exec_start");
 *   // ...
 *   profiler.checkpoint("tool_exec_end");
 *   const summary = profiler.summarize();
 *   // { total: 5200, phases: [{name: "generate", duration: 3100}, {name: "tool_exec", duration: 2100}] }
 */

export interface ProfilerCheckpoint {
  name: string;
  timestamp: number;
}

export interface ProfilerPhase {
  name: string;
  duration: number;
}

export interface ProfilerSummary {
  sessionId: string;
  turnStartedAt: number;
  totalDuration: number;
  phases: ProfilerPhase[];
  checkpoints: ProfilerCheckpoint[];
}

export interface TurnProfiler {
  checkpoint(name: string): void;
  summarize(): ProfilerSummary;
  reset(): void;
}

export function createTurnProfiler(sessionId: string): TurnProfiler {
  let checkpoints: ProfilerCheckpoint[] = [];
  const startTime = Date.now();

  return {
    checkpoint(name: string) {
      checkpoints.push({ name, timestamp: Date.now() });
    },

    summarize(): ProfilerSummary {
      const phases: ProfilerPhase[] = [];

      // Detect paired checkpoints (name_start / name_end)
      const starts = new Map<string, number>();
      for (const cp of checkpoints) {
        if (cp.name.endsWith("_start")) {
          const phaseName = cp.name.slice(0, -6); // strip _start
          starts.set(phaseName, cp.timestamp);
        } else if (cp.name.endsWith("_end")) {
          const phaseName = cp.name.slice(0, -4); // strip _end
          const startTs = starts.get(phaseName);
          if (startTs !== undefined) {
            phases.push({ name: phaseName, duration: cp.timestamp - startTs });
            starts.delete(phaseName);
          }
        }
      }

      // Also compute sequential durations between all checkpoints
      const totalDuration = checkpoints.length > 0
        ? checkpoints[checkpoints.length - 1]!.timestamp - startTime
        : 0;

      return {
        sessionId,
        turnStartedAt: startTime,
        totalDuration,
        phases,
        checkpoints: [...checkpoints],
      };
    },

    reset() {
      checkpoints = [];
    },
  };
}

/**
 * Format profiler summary as a concise log string.
 */
export function formatProfilerSummary(summary: ProfilerSummary): string {
  const parts = [`[profiler] session=${summary.sessionId} total=${summary.totalDuration}ms`];
  for (const phase of summary.phases) {
    parts.push(`${phase.name}=${phase.duration}ms`);
  }
  return parts.join(" ");
}

/**
 * Global profiler registry — allows multiple sessions to have profilers.
 */
const profilers = new Map<string, TurnProfiler>();

export function getOrCreateProfiler(sessionId: string): TurnProfiler {
  let profiler = profilers.get(sessionId);
  if (!profiler) {
    profiler = createTurnProfiler(sessionId);
    profilers.set(sessionId, profiler);
  }
  return profiler;
}

export function clearProfiler(sessionId: string): void {
  profilers.delete(sessionId);
}

export function getAllProfilers(): Map<string, TurnProfiler> {
  return profilers;
}
