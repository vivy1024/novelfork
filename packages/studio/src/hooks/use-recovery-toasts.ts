/**
 * Package 6 / 7.3.3 — recovery state toast bridge.
 *
 * Subscribes to `useWindowRuntimeStore.recoveryStates` and emits toast
 * notifications on the canonical five-state transitions. All toasts for a given
 * windowId share the id `recovery-<windowId>` so the most recent transition
 * replaces the previous one in place, keeping the notification stack clean.
 *
 * Transitions covered:
 *   idle → reconnecting            warning ("连接中断，正在重连…")
 *   reconnecting → replaying       info    ("正在回放历史…")
 *   replaying → idle               success ("会话已恢复")
 *   * → resetting                  error   ("会话已重置")
 *
 * Transitions intentionally NOT toasted (noise avoidance):
 *   - First seen window (prev=undefined → idle)
 *   - Window removal (handled by `clearWindowRuntime`; state map drops the key)
 *   - idle ↔ idle steady state
 */
import { useEffect, useRef } from "react";

import { useWindowRuntimeStore, type WindowRecoveryState } from "@/stores/windowRuntimeStore";
import { notify } from "@/lib/notify";

type StateMap = Record<string, WindowRecoveryState>;

function toastId(windowId: string): string {
  return `recovery-${windowId}`;
}

function emitToastForTransition(
  windowId: string,
  prev: WindowRecoveryState | undefined,
  next: WindowRecoveryState,
) {
  const id = toastId(windowId);

  // `resetting` is dominant — surface it regardless of prev state because it
  // represents a server-driven history discard.
  if (next === "resetting" && prev !== "resetting") {
    notify.error("会话已重置", {
      description: "历史记录可能已被丢弃，正在重新同步",
      id,
    });
    return;
  }

  if (prev === "idle" && next === "reconnecting") {
    notify.warning("连接中断，正在重连…", { id });
    return;
  }

  if (prev === "reconnecting" && next === "replaying") {
    notify.info("正在回放历史…", { id });
    return;
  }

  if (prev === "replaying" && next === "idle") {
    notify.success("会话已恢复", { id });
    return;
  }

  // Additional safety net: any non-idle → idle transition counts as recovery
  // success (e.g. reconnecting → idle without replay phase on small windows).
  if (prev && prev !== "idle" && prev !== "resetting" && next === "idle") {
    notify.success("会话已恢复", { id });
  }
}

export function useRecoveryToasts() {
  // Snapshot of the previous state map; compared on each store update so we
  // only react to genuine transitions, not re-renders.
  const prevRef = useRef<StateMap>({});

  useEffect(() => {
    // Seed with the current map so already-connected windows do not trigger
    // toasts on mount.
    prevRef.current = { ...useWindowRuntimeStore.getState().recoveryStates };

    const unsubscribe = useWindowRuntimeStore.subscribe((state) => {
      const nextMap = state.recoveryStates;
      const prevMap = prevRef.current;

      const windowIds = new Set<string>([
        ...Object.keys(prevMap),
        ...Object.keys(nextMap),
      ]);

      for (const windowId of windowIds) {
        const prev = prevMap[windowId];
        const next = nextMap[windowId];

        // Skip removal (next=undefined) — the close flow owns its own UI.
        if (next === undefined) continue;
        // Skip first appearance — do not announce "online" for a fresh window.
        if (prev === undefined) continue;
        if (prev === next) continue;

        emitToastForTransition(windowId, prev, next);
      }

      prevRef.current = { ...nextMap };
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
