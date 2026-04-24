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
 *   idle+online → idle+offline     warning ("会话暂时离线")
 *     — covers the "silent offline" case where recoveryState never leaves idle
 *       (e.g. backend crash before any reconnect handshake). The RecoveryBadge
 *       chip already shows this, but users with the banner hidden get no
 *       feedback without this toast.
 *
 * Transitions intentionally NOT toasted (noise avoidance):
 *   - First seen window (prev=undefined → idle)
 *   - Window removal (handled by `clearWindowRuntime`; state map drops the key)
 *   - idle ↔ idle steady state with connectivity unchanged
 */
import { useEffect, useRef } from "react";

import { useWindowRuntimeStore, type WindowRecoveryState } from "@/stores/windowRuntimeStore";
import { notify } from "@/lib/notify";

type StateMap = Record<string, WindowRecoveryState>;
type ConnectionMap = Record<string, boolean>;

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

function emitOfflineToastIfNeeded(
  windowId: string,
  prevConnected: boolean | undefined,
  nextConnected: boolean,
  nextState: WindowRecoveryState,
) {
  // Only surface the silent-offline transition. Non-idle states already own
  // the user's attention via dedicated transition toasts above, so we do not
  // want to stack a second "离线" toast on top of "重连中".
  if (nextState !== "idle") return;
  if (prevConnected !== true || nextConnected !== false) return;

  notify.warning("会话暂时离线", {
    id: toastId(windowId),
    description: "服务端通道已断开，正在等待恢复。",
  });
}

export function useRecoveryToasts() {
  // Snapshots of the previous state + connection maps; compared on each store
  // update so we only react to genuine transitions, not re-renders.
  const prevStateRef = useRef<StateMap>({});
  const prevConnectionRef = useRef<ConnectionMap>({});

  useEffect(() => {
    // Seed with the current maps so already-connected windows do not trigger
    // toasts on mount.
    const initial = useWindowRuntimeStore.getState();
    prevStateRef.current = { ...initial.recoveryStates };
    prevConnectionRef.current = { ...initial.wsConnections };

    const unsubscribe = useWindowRuntimeStore.subscribe((state) => {
      const nextStateMap = state.recoveryStates;
      const nextConnectionMap = state.wsConnections;
      const prevStateMap = prevStateRef.current;
      const prevConnectionMap = prevConnectionRef.current;

      const windowIds = new Set<string>([
        ...Object.keys(prevStateMap),
        ...Object.keys(nextStateMap),
        ...Object.keys(prevConnectionMap),
        ...Object.keys(nextConnectionMap),
      ]);

      for (const windowId of windowIds) {
        const prevState = prevStateMap[windowId];
        const nextState = nextStateMap[windowId];
        const prevConnected = prevConnectionMap[windowId];
        const nextConnected = nextConnectionMap[windowId];

        // Skip removal (next=undefined) — the close flow owns its own UI.
        if (nextState === undefined) continue;
        // Skip first appearance — do not announce "online" for a fresh window.
        if (prevState === undefined) continue;

        if (prevState !== nextState) {
          emitToastForTransition(windowId, prevState, nextState);
        } else if (nextConnected !== undefined) {
          emitOfflineToastIfNeeded(windowId, prevConnected, nextConnected, nextState);
        }
      }

      prevStateRef.current = { ...nextStateMap };
      prevConnectionRef.current = { ...nextConnectionMap };
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
