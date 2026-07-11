const TURN_LEASE_SECRET = Symbol("novelfork.turn-lease.secret");

export const MAX_QUEUE_SIZE = 10;

export type TurnGateEnqueueResult = "started" | "queued" | "queue-full";
export type QueuedItemCancellationReason = "session-disposed" | "transport-disconnected";

export interface QueuedItemCancellation<TItem = unknown> {
  readonly sessionId: string;
  readonly item: TItem;
  readonly reason: QueuedItemCancellationReason;
  readonly queuedAt: number;
  readonly sequence: number;
}

export interface TurnRunError<TItem = unknown> {
  readonly sessionId: string;
  readonly item: TItem;
  readonly error: unknown;
}

export type TurnGateRun<TItem = unknown> = (lease: TurnLease, item: TItem) => void | Promise<void>;

export interface SessionTurnGateOptions<TItem = unknown> {
  readonly maxQueueSize?: number;
  readonly onRunError?: (event: TurnRunError<TItem>) => void | Promise<void>;
}

export class SessionTurnGateDisposedError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`session-runtime-disposed: turn gate session is disposed: ${sessionId}`);
    this.name = "SessionTurnGateDisposedError";
    this.sessionId = sessionId;
  }
}

export class TurnLease {
  readonly #serverBrand = true;
  readonly #retain: (settlement: Promise<void>) => void;
  readonly sessionId: string;
  readonly rootSignal: AbortSignal;

  constructor(
    secret: typeof TURN_LEASE_SECRET,
    sessionId: string,
    rootSignal: AbortSignal,
    retain: (settlement: Promise<void>) => void,
  ) {
    if (secret !== TURN_LEASE_SECRET) {
      throw new Error("TurnLease can only be created by SessionTurnGate");
    }
    this.sessionId = sessionId;
    this.rootSignal = rootSignal;
    this.#retain = retain;
  }

  get signal(): AbortSignal {
    return this.rootSignal;
  }

  hasServerIdentity(): boolean {
    return this.#serverBrand;
  }

  /** Keep this lease active after its runner returns until real runtime settlement. */
  retainUntil(settlement: PromiseLike<unknown>): void {
    this.#retain(Promise.resolve(settlement).then(() => undefined));
  }
}

interface QueuedTurn<TItem> {
  readonly sessionId: string;
  readonly item: TItem;
  readonly run: TurnGateRun<TItem>;
  readonly queuedAt: number;
  readonly sequence: number;
}

interface ActiveTurn<TItem> {
  readonly sessionId: string;
  readonly item: TItem;
  readonly controller: AbortController;
  readonly lease: TurnLease;
  readonly retainedSettlements: Set<Promise<void>>;
  readonly settled: Promise<void>;
  resolveSettled(): void;
}

interface SessionTurnState<TItem> {
  active: ActiveTurn<TItem> | undefined;
  queue: QueuedTurn<TItem>[];
  disposePromise: Promise<QueuedItemCancellation<TItem>[]> | undefined;
}

export class SessionTurnGate<TItem = unknown> {
  readonly #maxQueueSize: number;
  readonly #onRunError: ((event: TurnRunError<TItem>) => void | Promise<void>) | undefined;
  readonly #sessions = new Map<string, SessionTurnState<TItem>>();
  readonly #disposedSessions = new Set<string>();
  #nextSequence = 0;

  constructor(options: SessionTurnGateOptions<TItem> = {}) {
    const maxQueueSize = options.maxQueueSize ?? MAX_QUEUE_SIZE;
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 0) {
      throw new Error(`SessionTurnGate maxQueueSize must be a non-negative integer: ${maxQueueSize}`);
    }
    this.#maxQueueSize = maxQueueSize;
    this.#onRunError = options.onRunError;
  }

  async enqueue(sessionId: string, item: TItem, run: TurnGateRun<TItem>): Promise<TurnGateEnqueueResult> {
    if (this.#disposedSessions.has(sessionId)) {
      throw new SessionTurnGateDisposedError(sessionId);
    }

    const state = this.#getOrCreateState(sessionId);
    if (!state.active) {
      this.#startTurn(state, this.#createQueuedTurn(sessionId, item, run));
      return "started";
    }

    if (state.queue.length >= this.#maxQueueSize) {
      return "queue-full";
    }

    state.queue.push(this.#createQueuedTurn(sessionId, item, run));
    return "queued";
  }

  hasActive(sessionId: string): boolean {
    return Boolean(this.#sessions.get(sessionId)?.active);
  }

  /**
   * Resolves after the current active lease and all currently queued successor
   * leases have drained. If a new item races in after the session becomes idle,
   * it creates a new lifecycle and callers can await it separately.
   */
  async waitForIdle(sessionId: string): Promise<void> {
    while (true) {
      const state = this.#sessions.get(sessionId);
      if (!state) {
        return;
      }

      const active = state.active;
      if (!active && state.queue.length === 0) {
        return;
      }

      if (active) {
        await active.settled;
      } else {
        // State transitions are synchronous, but yield once if an observer
        // catches the narrow window between release and the next drain.
        await Promise.resolve();
      }
    }
  }

  requestAbort(sessionId: string): boolean {
    const active = this.#sessions.get(sessionId)?.active;
    if (!active) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  cancelQueued(
    sessionId: string,
    predicate: (item: TItem) => boolean,
    reason: QueuedItemCancellationReason = "transport-disconnected",
  ): QueuedItemCancellation<TItem>[] {
    const state = this.#sessions.get(sessionId);
    if (!state || state.queue.length === 0) {
      return [];
    }

    const retained: QueuedTurn<TItem>[] = [];
    const cancellations: QueuedItemCancellation<TItem>[] = [];
    for (const queued of state.queue) {
      if (predicate(queued.item)) {
        cancellations.push({
          sessionId,
          item: queued.item,
          reason,
          queuedAt: queued.queuedAt,
          sequence: queued.sequence,
        });
      } else {
        retained.push(queued);
      }
    }
    state.queue = retained;
    return cancellations;
  }

  async dispose(
    sessionId: string,
    onQueuedCancelled?: (cancellations: readonly QueuedItemCancellation<TItem>[]) => void,
  ): Promise<QueuedItemCancellation<TItem>[]> {
    const state = this.#sessions.get(sessionId);
    if (state?.disposePromise) {
      return state.disposePromise;
    }

    if (this.#disposedSessions.has(sessionId)) {
      return [];
    }

    if (!state) {
      this.#disposedSessions.add(sessionId);
      return [];
    }

    this.#disposedSessions.add(sessionId);

    const cancellations = this.cancelQueued(sessionId, () => true, "session-disposed");
    let cancellationObserverError: unknown;
    try {
      onQueuedCancelled?.(cancellations);
    } catch (error) {
      cancellationObserverError = error;
    }

    const active = state.active;
    if (active) {
      active.controller.abort();
    }

    state.disposePromise = (active?.settled ?? Promise.resolve())
      .then(() => {
        this.#sessions.delete(sessionId);
        if (cancellationObserverError !== undefined) throw cancellationObserverError;
        return cancellations;
      })
      .finally(() => {
        state.disposePromise = undefined;
      });
    return state.disposePromise;
  }

  #getOrCreateState(sessionId: string): SessionTurnState<TItem> {
    let state = this.#sessions.get(sessionId);
    if (!state) {
      state = {
        active: undefined,
        queue: [],
        disposePromise: undefined,
      };
      this.#sessions.set(sessionId, state);
    }
    return state;
  }

  #createQueuedTurn(sessionId: string, item: TItem, run: TurnGateRun<TItem>): QueuedTurn<TItem> {
    return {
      sessionId,
      item,
      run,
      queuedAt: Date.now(),
      sequence: this.#nextSequence++,
    };
  }

  #startTurn(state: SessionTurnState<TItem>, queued: QueuedTurn<TItem>): void {
    const controller = new AbortController();
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });

    const retainedSettlements = new Set<Promise<void>>();
    const active: ActiveTurn<TItem> = {
      sessionId: queued.sessionId,
      item: queued.item,
      controller,
      lease: new TurnLease(TURN_LEASE_SECRET, queued.sessionId, controller.signal, (settlement) => {
        retainedSettlements.add(settlement);
      }),
      retainedSettlements,
      settled,
      resolveSettled,
    };

    state.active = active;

    void Promise.resolve()
      .then(() => queued.run(active.lease, queued.item))
      .catch((error) => {
        this.#notifyRunError({ sessionId: queued.sessionId, item: queued.item, error });
      })
      .then(() => this.#waitForRetainedSettlements(active))
      .finally(() => {
        this.#releaseTurn(state, active);
      });
  }

  async #waitForRetainedSettlements(active: ActiveTurn<TItem>): Promise<void> {
    while (active.retainedSettlements.size > 0) {
      const snapshot = [...active.retainedSettlements];
      await Promise.allSettled(snapshot);
      for (const settlement of snapshot) active.retainedSettlements.delete(settlement);
    }
  }

  #releaseTurn(state: SessionTurnState<TItem>, active: ActiveTurn<TItem>): void {
    if (state.active !== active) {
      active.resolveSettled();
      return;
    }

    state.active = undefined;
    active.resolveSettled();
    this.#drain(active.sessionId, state);
  }

  #drain(sessionId: string, state: SessionTurnState<TItem>): void {
    if (state.active || this.#disposedSessions.has(sessionId)) {
      return;
    }

    const next = state.queue.shift();
    if (!next) {
      this.#sessions.delete(sessionId);
      return;
    }

    this.#startTurn(state, next);
  }

  #notifyRunError(event: TurnRunError<TItem>): void {
    if (!this.#onRunError) {
      return;
    }

    try {
      void Promise.resolve(this.#onRunError(event)).catch(() => {
        // Error observers are diagnostic-only; never let them lock the gate,
        // produce unhandled rejections, or block finally/drain progression.
      });
    } catch {
      // Synchronous observer failure must be swallowed for the same reason.
    }
  }
}
