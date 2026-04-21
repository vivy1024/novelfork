import { create } from "zustand";
import { persist } from "zustand/middleware";

import { type NarratorSessionMode } from "../shared/session-types";

export interface ChatWindow {
  id: string;
  title: string;
  agentId: string;
  sessionId?: string;
  sessionMode?: NarratorSessionMode;
  position: { x: number; y: number; w: number; h: number };
  minimized: boolean;
}

export interface AddWindowInput {
  agentId: string;
  title: string;
  sessionId?: string;
  sessionMode?: NarratorSessionMode;
}

interface WindowStore {
  windows: ChatWindow[];
  activeWindowId: string | null;
  addWindow: (input: AddWindowInput) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindow>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  updateLayout: (id: string, position: { x: number; y: number; w: number; h: number }) => void;
}

export const useWindowStore = create<WindowStore>()(
  persist(
    (set) => ({
      windows: [],
      activeWindowId: null,

      addWindow: (input) =>
        set((state) => {
          const id = `window-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const newWindow: ChatWindow = {
            id,
            title: input.title,
            agentId: input.agentId,
            sessionId: input.sessionId,
            sessionMode: input.sessionMode,
            position: {
              x: (state.windows.length * 2) % 10,
              y: (state.windows.length * 2) % 10,
              w: 6,
              h: 8,
            },
            minimized: false,
          };
          return { windows: [...state.windows, newWindow], activeWindowId: id };
        }),

      removeWindow: (id) =>
        set((state) => {
          const nextWindows = state.windows.filter((window) => window.id !== id);
          const nextActiveWindowId = state.activeWindowId === id
            ? (nextWindows.at(-1)?.id ?? null)
            : state.activeWindowId;
          return {
            windows: nextWindows,
            activeWindowId: nextActiveWindowId,
          };
        }),

      updateWindow: (id, updates) =>
        set((state) => ({
          windows: state.windows.map((window) => (window.id === id ? { ...window, ...updates } : window)),
        })),

      toggleMinimize: (id) =>
        set((state) => ({
          windows: state.windows.map((window) => (window.id === id ? { ...window, minimized: !window.minimized } : window)),
        })),

      setActiveWindow: (id) => set({ activeWindowId: id }),

      updateLayout: (id, position) =>
        set((state) => ({
          windows: state.windows.map((window) => (window.id === id ? { ...window, position } : window)),
        })),
    }),
    {
      name: "novelfork-window-store",
      partialize: (state) => ({
        windows: state.windows.map(({ id, title, agentId, sessionId, sessionMode, position, minimized }) => ({
          id,
          title,
          agentId,
          sessionId,
          sessionMode,
          position,
          minimized,
        })),
        activeWindowId: state.activeWindowId,
      }),
    },
  ),
);
