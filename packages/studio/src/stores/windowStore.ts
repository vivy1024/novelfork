import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ToolCall {
  toolName: string;
  command: string;
  duration: number;
  output: string;
  error?: string;
  exitCode?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ChatWindow {
  id: string;
  title: string;
  agentId: string;
  position: { x: number; y: number; w: number; h: number };
  minimized: boolean;
  messages: ChatMessage[];
  wsConnected: boolean;
}

interface WindowStore {
  windows: ChatWindow[];
  activeWindowId: string | null;
  addWindow: (agentId: string, title: string) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindow>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  addMessage: (windowId: string, message: ChatMessage) => void;
  updateLayout: (id: string, position: { x: number; y: number; w: number; h: number }) => void;
  setWsConnected: (windowId: string, connected: boolean) => void;
}

export const useWindowStore = create<WindowStore>()(
  persist(
    (set) => ({
      windows: [],
      activeWindowId: null,

      addWindow: (agentId, title) =>
        set((state) => {
          const id = `window-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const newWindow: ChatWindow = {
            id,
            title,
            agentId,
            position: {
              x: (state.windows.length * 2) % 10,
              y: (state.windows.length * 2) % 10,
              w: 6,
              h: 8,
            },
            minimized: false,
            messages: [],
            wsConnected: false,
          };
          return { windows: [...state.windows, newWindow], activeWindowId: id };
        }),

      removeWindow: (id) =>
        set((state) => ({
          windows: state.windows.filter((w) => w.id !== id),
          activeWindowId: state.activeWindowId === id ? null : state.activeWindowId,
        })),

      updateWindow: (id, updates) =>
        set((state) => ({
          windows: state.windows.map((w) => (w.id === id ? { ...w, ...updates } : w)),
        })),

      toggleMinimize: (id) =>
        set((state) => ({
          windows: state.windows.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)),
        })),

      setActiveWindow: (id) => set({ activeWindowId: id }),

      addMessage: (windowId, message) =>
        set((state) => ({
          windows: state.windows.map((w) =>
            w.id === windowId ? { ...w, messages: [...w.messages, message] } : w
          ),
        })),

      updateLayout: (id, position) =>
        set((state) => ({
          windows: state.windows.map((w) => (w.id === id ? { ...w, position } : w)),
        })),

      setWsConnected: (windowId, connected) =>
        set((state) => ({
          windows: state.windows.map((w) => (w.id === windowId ? { ...w, wsConnected: connected } : w)),
        })),
    }),
    {
      name: "inkos-chat-windows",
      partialize: (state) => ({
        windows: state.windows.map((w) => ({
          ...w,
          messages: w.messages.slice(-50), // 只持久化最近 50 条消息
          wsConnected: false, // 重启后重连
        })),
      }),
    }
  )
);
