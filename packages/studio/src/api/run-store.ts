import { randomUUID } from "node:crypto";

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunEvent {
  readonly eventId: string;
  readonly seq: number;
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

export interface RunState {
  readonly runId: string;
  readonly bookId: string;
  readonly operation: string;
  status: RunStatus;
  events: RunEvent[];
  subscribers: Set<(event: RunEvent) => void>;
  seq: number;
  createdAt: number;
}

export class RunStore {
  private runs = new Map<string, RunState>();
  // 清理超过 1 小时的已完成 run
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  createRun(bookId: string, operation: string): string {
    const runId = randomUUID();
    this.runs.set(runId, {
      runId, bookId, operation,
      status: 'pending',
      events: [],
      subscribers: new Set(),
      seq: 0,
      createdAt: Date.now(),
    });
    return runId;
  }

  pushEvent(runId: string, event: string, data: unknown): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const runEvent: RunEvent = {
      eventId: randomUUID(),
      seq: ++run.seq,
      event,
      data,
      timestamp: Date.now(),
    };
    run.events.push(runEvent);
    for (const sub of run.subscribers) sub(runEvent);
  }

  setStatus(runId: string, status: RunStatus): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = status;
    this.pushEvent(runId, 'status', { status });
  }

  subscribe(runId: string, callback: (event: RunEvent) => void): () => void {
    const run = this.runs.get(runId);
    if (!run) return () => {};
    run.subscribers.add(callback);
    return () => run.subscribers.delete(callback);
  }

  getRun(runId: string): RunState | undefined { return this.runs.get(runId); }

  getEventsSince(runId: string, lastEventId?: string): RunEvent[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    if (!lastEventId) return [...run.events];
    const idx = run.events.findIndex(e => e.eventId === lastEventId);
    return idx === -1 ? [...run.events] : run.events.slice(idx + 1);
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status === 'completed' || run.status === 'failed') return false;
    this.setStatus(runId, 'cancelled');
    return true;
  }

  private cleanup(): void {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, run] of this.runs) {
      if ((run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') && run.createdAt < cutoff) {
        this.runs.delete(id);
      }
    }
  }
}
