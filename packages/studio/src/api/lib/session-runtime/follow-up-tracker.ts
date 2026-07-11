export interface FollowUpFailure {
  readonly label: string;
  readonly message: string;
}

export interface FollowUpDisposeReport {
  readonly ok: boolean;
  readonly ownerSessionId: string;
  readonly errors: FollowUpFailure[];
}

interface OwnerFollowUps {
  readonly pending: Set<Promise<void>>;
  readonly errors: FollowUpFailure[];
  drainPromise?: Promise<FollowUpDisposeReport>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return "unserializable follow-up error";
  }
}

export class SessionRuntimeFollowUpTracker {
  readonly #owners = new Map<string, OwnerFollowUps>();

  track(ownerSessionId: string, label: string, operation: PromiseLike<unknown>): Promise<void> {
    const owner = this.#getOrCreateOwner(ownerSessionId);
    let settled!: Promise<void>;
    settled = Promise.resolve(operation)
      .then(() => undefined, (error) => {
        owner.errors.push({ label, message: errorMessage(error) });
      })
      .finally(() => {
        owner.pending.delete(settled);
        this.#deleteOwnerIfEmpty(ownerSessionId, owner);
      });
    owner.pending.add(settled);
    return settled;
  }

  hasPending(ownerSessionId: string): boolean {
    return (this.#owners.get(ownerSessionId)?.pending.size ?? 0) > 0;
  }

  async waitForIdle(ownerSessionId: string): Promise<void> {
    while (true) {
      const owner = this.#owners.get(ownerSessionId);
      if (!owner || owner.pending.size === 0) return;
      await Promise.all([...owner.pending]);
    }
  }

  disposeOwner(ownerSessionId: string): Promise<FollowUpDisposeReport> {
    const owner = this.#getOrCreateOwner(ownerSessionId);
    if (owner.drainPromise) return owner.drainPromise;

    const drain = (async () => {
      await this.waitForIdle(ownerSessionId);
      const errors = owner.errors.splice(0);
      return { ok: errors.length === 0, ownerSessionId, errors };
    })();
    const operation = drain.finally(() => {
      if (owner.drainPromise === operation) owner.drainPromise = undefined;
      this.#deleteOwnerIfEmpty(ownerSessionId, owner);
    });
    owner.drainPromise = operation;
    return operation;
  }

  #getOrCreateOwner(ownerSessionId: string): OwnerFollowUps {
    let owner = this.#owners.get(ownerSessionId);
    if (!owner) {
      owner = { pending: new Set(), errors: [] };
      this.#owners.set(ownerSessionId, owner);
    }
    return owner;
  }

  #deleteOwnerIfEmpty(ownerSessionId: string, owner: OwnerFollowUps): void {
    if (owner.pending.size === 0 && owner.errors.length === 0 && !owner.drainPromise) {
      this.#owners.delete(ownerSessionId);
    }
  }
}

const processFollowUpTracker = new SessionRuntimeFollowUpTracker();

export function getSessionRuntimeFollowUpTracker(): SessionRuntimeFollowUpTracker {
  return processFollowUpTracker;
}

export function trackSessionRuntimeFollowUp(
  ownerSessionId: string,
  label: string,
  operation: PromiseLike<unknown>,
): Promise<void> {
  return processFollowUpTracker.track(ownerSessionId, label, operation);
}
