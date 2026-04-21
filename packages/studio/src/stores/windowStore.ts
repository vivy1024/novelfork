import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  type NarratorSessionMode,
  type SessionConfig,
  type SessionPermissionMode,
  type SessionReasoningEffort,
} from "../shared/session-types";

export type ToolCallStatus = "pending" | "running" | "success" | "error";

export interface ToolCall {
  id?: string;
  toolName: string;
  status?: ToolCallStatus;
  summary?: string;
  command?: string;
  input?: unknown;
  duration?: number;
  output?: string;
  result?: unknown;
  error?: string;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
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
  sessionId?: string;
  sessionMode?: NarratorSessionMode;
  position: { x: number; y: number; w: number; h: number };
  minimized: boolean;
  messages: ChatMessage[];
  wsConnected: boolean;
  sessionConfig?: SessionConfig;
}

interface AddWindowInput {
  agentId: string;
  title: string;
  sessionId?: string;
  sessionMode?: NarratorSessionMode;
  sessionConfig?: SessionConfig;
}

interface WindowStore {
  windows: ChatWindow[];
  activeWindowId: string | null;
  addWindow: (agentIdOrInput: string | AddWindowInput, title?: string) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<ChatWindow>) => void;
  toggleMinimize: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  addMessage: (windowId: string, message: ChatMessage) => void;
  updateLayout: (id: string, position: { x: number; y: number; w: number; h: number }) => void;
  setWsConnected: (windowId: string, connected: boolean) => void;
}

function normalizeAddWindowInput(agentIdOrInput: string | AddWindowInput, title?: string): AddWindowInput {
  if (typeof agentIdOrInput === "string") {
    return {
      agentId: agentIdOrInput,
      title: title ?? "Untitled Session",
    };
  }
  return agentIdOrInput;
}

export const useWindowStore = create<WindowStore>()(
  persist(
    (set) => ({
      windows: [],
      activeWindowId: null,

      addWindow: (agentIdOrInput, title) =>
        set((state) => {
          const normalized = normalizeAddWindowInput(agentIdOrInput, title);
          const id = `window-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const newWindow: ChatWindow = {
            id,
            title: normalized.title,
            agentId: normalized.agentId,
            sessionId: normalized.sessionId,
            sessionMode: normalized.sessionMode,
            position: {
              x: (state.windows.length * 2) % 10,
              y: (state.windows.length * 2) % 10,
              w: 6,
              h: 8,
            },
            minimized: false,
            messages: [],
            wsConnected: false,
            sessionConfig: normalized.sessionConfig,
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
            w.id === windowId ? { ...w, messages: [...w.messages, message] } : w,
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
      name: "novelfork-chat-windows",
      partialize: (state) => ({
        windows: state.windows.map((w) => ({
          ...w,
          messages: w.messages.slice(-50),
          wsConnected: false,
        })),
      }),
    },
  ),
);

export type { SessionConfig, SessionPermissionMode, SessionReasoningEffort };
