import { create } from "zustand";

import type { NarratorSessionChatSnapshot, NarratorSessionRecoveryState } from "../shared/session-types";

export type WindowRecoveryState = NarratorSessionRecoveryState;

interface WindowRuntimeStore {
  wsConnections: Record<string, boolean>;
  recoveryStates: Record<string, WindowRecoveryState>;
  chatSnapshots: Record<string, NarratorSessionChatSnapshot | null>;
  setWsConnected: (windowId: string, connected: boolean) => void;
  setRecoveryState: (windowId: string, recoveryState: WindowRecoveryState) => void;
  setChatSnapshot: (windowId: string, snapshot: NarratorSessionChatSnapshot | null) => void;
  clearWindowRuntime: (windowId: string) => void;
}

export const useWindowRuntimeStore = create<WindowRuntimeStore>()((set) => ({
  wsConnections: {},
  recoveryStates: {},
  chatSnapshots: {},
  setWsConnected: (windowId, connected) =>
    set((state) => {
      if (state.wsConnections[windowId] === connected) {
        return state;
      }

      return {
        wsConnections: {
          ...state.wsConnections,
          [windowId]: connected,
        },
      };
    }),
  setRecoveryState: (windowId, recoveryState) =>
    set((state) => {
      if (state.recoveryStates[windowId] === recoveryState) {
        return state;
      }

      return {
        recoveryStates: {
          ...state.recoveryStates,
          [windowId]: recoveryState,
        },
      };
    }),
  setChatSnapshot: (windowId, snapshot) =>
    set((state) => {
      if (state.chatSnapshots[windowId] === snapshot) {
        return state;
      }

      return {
        chatSnapshots: {
          ...state.chatSnapshots,
          [windowId]: snapshot,
        },
      };
    }),
  clearWindowRuntime: (windowId) =>
    set((state) => {
      if (!(windowId in state.wsConnections) && !(windowId in state.recoveryStates) && !(windowId in state.chatSnapshots)) {
        return state;
      }

      const nextConnections = { ...state.wsConnections };
      const nextRecoveryStates = { ...state.recoveryStates };
      const nextChatSnapshots = { ...state.chatSnapshots };
      delete nextConnections[windowId];
      delete nextRecoveryStates[windowId];
      delete nextChatSnapshots[windowId];
      return {
        wsConnections: nextConnections,
        recoveryStates: nextRecoveryStates,
        chatSnapshots: nextChatSnapshots,
      };
    }),
}));
