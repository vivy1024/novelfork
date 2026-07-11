const RUNTIME_SETTLEMENT = Symbol.for("novelfork.runtime-settlement");
const runtimeSettlements = new WeakMap<object, Promise<unknown>>();

type RuntimeSettlementCarrier = {
  [RUNTIME_SETTLEMENT]?: Promise<unknown>;
};

/** Associates an internal real-runtime settlement with a serializable tool result. */
export function attachRuntimeSettlement<T extends object>(result: T, settlement: PromiseLike<unknown>): T {
  const promise = Promise.resolve(settlement);
  runtimeSettlements.set(result, promise);
  // Enumerable symbols survive internal object spreads while JSON ignores them.
  Object.defineProperty(result, RUNTIME_SETTLEMENT, {
    value: promise,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return result;
}

/** Returns the internal settlement without exposing promises in public tool payloads. */
export function getRuntimeSettlement(result: unknown): Promise<unknown> | undefined {
  if (result === null || (typeof result !== "object" && typeof result !== "function")) return undefined;
  return runtimeSettlements.get(result as object) ?? (result as RuntimeSettlementCarrier)[RUNTIME_SETTLEMENT];
}
