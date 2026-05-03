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

const memoryWindowStoreStorage = new Map<string, string>();

function getLocalStorage(): Storage | null {
  return globalThis.localStorage ?? null;
}

function hasCompleteStorageApi(storage: Storage | null): storage is Storage {
  return Boolean(
    storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

const windowStoreStorage: PersistStorage<PersistedWindowStore> = {
  getItem: (name) => {
    try {
      const storage = getLocalStorage();
      const raw = hasCompleteStorageApi(storage) ? storage.getItem(name) : memoryWindowStoreStorage.get(name) ?? null;
      return raw ? JSON.parse(raw) as StorageValue<PersistedWindowStore> : null;
    } catch (error) {
      console.warn("[windowStore] localStorage getItem failed; using memory fallback", error);
      const raw = memoryWindowStoreStorage.get(name) ?? null;
      return raw ? JSON.parse(raw) as StorageValue<PersistedWindowStore> : null;
    }
  },
  setItem: (name, value) => {
    const serialized = JSON.stringify(value);
    const storage = getLocalStorage();
    if (hasCompleteStorageApi(storage)) {
      try {
        storage.setItem(name, serialized);
        return;
      } catch (error) {
        console.warn("[windowStore] localStorage setItem failed; using memory fallback", error);
      }
    }
    memoryWindowStoreStorage.set(name, serialized);
  },
  removeItem: (name) => {
    const storage = getLocalStorage();
    if (hasCompleteStorageApi(storage)) {
      try {
        storage.removeItem(name);
        return;
      } catch (error) {
        console.warn("[windowStore] localStorage removeItem failed; using memory fallback", error);
      }
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
