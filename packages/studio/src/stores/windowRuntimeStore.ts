import { create } from "zustand";

export type WindowRecoveryState = "idle" | "reconnecting" | "replaying" | "resetting";

interface WindowRuntimeStore {
  wsConnections: Record<string, boolean>;
  recoveryStates: Record<string, WindowRecoveryState>;
  setWsConnected: (windowId: string, connected: boolean) => void;
  setRecoveryState: (windowId: string, recoveryState: WindowRecoveryState) => void;
  clearWindowRuntime: (windowId: string) => void;
}

export const useWindowRuntimeStore = create<WindowRuntimeStore>()((set) => ({
  wsConnections: {},
  recoveryStates: {},
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
  clearWindowRuntime: (windowId) =>
    set((state) => {
      if (!(windowId in state.wsConnections) && !(windowId in state.recoveryStates)) {
        return state;
      }

      const nextConnections = { ...state.wsConnections };
      const nextRecoveryStates = { ...state.recoveryStates };
      delete nextConnections[windowId];
      delete nextRecoveryStates[windowId];
      return {
        wsConnections: nextConnections,
        recoveryStates: nextRecoveryStates,
      };
    }),
}));
