import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

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
  addWindow: (input: AddWindowInput) => string;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindow>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  updateLayout: (id: string, position: { x: number; y: number; w: number; h: number }) => void;
}

type PersistedWindowStore = Pick<WindowStore, "windows" | "activeWindowId">;

type JsonStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memoryWindowStoreStorage = new Map<string, string>();

function getUsableLocalStorage(): JsonStorage | null {
  const storage = globalThis.localStorage;
  if (
    typeof storage?.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  ) {
    return storage;
  }
  return null;
}

const windowStoreStorage: PersistStorage<PersistedWindowStore> = {
  getItem: (name) => {
    try {
      const raw = getUsableLocalStorage()?.getItem(name) ?? memoryWindowStoreStorage.get(name) ?? null;
      return raw ? JSON.parse(raw) as StorageValue<PersistedWindowStore> : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    const serialized = JSON.stringify(value);
    try {
      const storage = getUsableLocalStorage();
      if (storage) {
        storage.setItem(name, serialized);
        return;
      }
    } catch {
      // Fall through to memory storage.
    }
    memoryWindowStoreStorage.set(name, serialized);
  },
  removeItem: (name) => {
    try {
      const storage = getUsableLocalStorage();
      if (storage) {
        storage.removeItem(name);
        return;
      }
    } catch {
      // Fall through to memory storage cleanup.
    }
    memoryWindowStoreStorage.delete(name);
  },
};

export const useWindowStore = create<WindowStore>()(
  persist(
    (set) => ({
      windows: [],
      activeWindowId: null,

      addWindow: (input) => {
        const id = `window-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        set((state) => {
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
        });
        return id;
      },

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
      storage: windowStoreStorage,
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
