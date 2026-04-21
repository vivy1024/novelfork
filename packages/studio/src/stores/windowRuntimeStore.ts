import { create } from "zustand";

interface WindowRuntimeStore {
  wsConnections: Record<string, boolean>;
  setWsConnected: (windowId: string, connected: boolean) => void;
  clearWindowRuntime: (windowId: string) => void;
}

export const useWindowRuntimeStore = create<WindowRuntimeStore>()((set) => ({
  wsConnections: {},
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
  clearWindowRuntime: (windowId) =>
    set((state) => {
      if (!(windowId in state.wsConnections)) {
        return state;
      }

      const nextConnections = { ...state.wsConnections };
      delete nextConnections[windowId];
      return { wsConnections: nextConnections };
    }),
}));
