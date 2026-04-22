export type SessionPermissionMode = "allow" | "ask" | "deny";
export type SessionReasoningEffort = "low" | "medium" | "high";

export interface SessionConfig {
  providerId: string;
  modelId: string;
  permissionMode: SessionPermissionMode;
  reasoningEffort: SessionReasoningEffort;
}

export type NarratorSessionKind = "standalone" | "chapter";
export type NarratorSessionStatus = "active" | "archived";
export type NarratorSessionMode = "chat" | "plan";

export interface NarratorSessionRecord {
  id: string;
  title: string;
  agentId: string;
  kind: NarratorSessionKind;
  sessionMode: NarratorSessionMode;
  status: NarratorSessionStatus;
  createdAt: string;
  lastModified: string;
  messageCount: number;
  sortOrder: number;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
  sessionConfig: SessionConfig;
  recentMessages?: NarratorSessionChatMessage[];
}

export interface CreateNarratorSessionInput {
  title?: string;
  agentId?: string;
  kind?: NarratorSessionKind;
  sessionMode?: NarratorSessionMode;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
  sessionConfig?: Partial<SessionConfig>;
}

export interface UpdateNarratorSessionInput {
  title?: string;
  agentId?: string;
  kind?: NarratorSessionKind;
  sessionMode?: NarratorSessionMode;
  status?: NarratorSessionStatus;
  messageCount?: number;
  sortOrder?: number;
  worktree?: string;
  chapterId?: string;
  projectId?: string;
  sessionConfig?: Partial<SessionConfig>;
  recentMessages?: NarratorSessionChatMessage[];
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  permissionMode: "allow",
  reasoningEffort: "medium",
};

export type NarratorSessionChatRole = "user" | "assistant" | "system";

export interface NarratorSessionChatMessage {
  id: string;
  role: NarratorSessionChatRole;
  content: string;
  timestamp: number;
  seq?: number;
  toolCalls?: ToolCall[];
}

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
  role: NarratorSessionChatRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface NarratorSessionChatCursor {
  lastSeq: number;
  ackedSeq?: number;
}

export interface NarratorSessionChatSnapshot {
  session: NarratorSessionRecord;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatCursor;
}

export interface NarratorSessionChatHistory {
  sessionId: string;
  sinceSeq: number;
  availableFromSeq: number;
  resetRequired: boolean;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatCursor;
}

export interface NarratorSessionChatMessageClientEnvelope {
  type?: "session:message";
  sessionId?: string;
  messageId?: string;
  content: string;
  sessionMode?: NarratorSessionMode;
  ack?: number;
}

export interface NarratorSessionChatAckClientEnvelope {
  type: "session:ack";
  sessionId?: string;
  ack: number;
}

export type NarratorSessionChatClientMessage =
  | NarratorSessionChatMessageClientEnvelope
  | NarratorSessionChatAckClientEnvelope;

export interface NarratorSessionChatSnapshotEnvelope {
  type: "session:snapshot";
  snapshot: NarratorSessionChatSnapshot;
}

export interface NarratorSessionChatStateEnvelope {
  type: "session:state";
  session: NarratorSessionRecord;
  cursor: NarratorSessionChatCursor;
}

export interface NarratorSessionChatMessageEnvelope {
  type: "session:message";
  sessionId: string;
  message: NarratorSessionChatMessage;
  cursor: NarratorSessionChatCursor;
}

export interface NarratorSessionChatErrorEnvelope {
  type: "session:error";
  sessionId?: string;
  error: string;
}

export type NarratorSessionChatServerEnvelope =
  | NarratorSessionChatSnapshotEnvelope
  | NarratorSessionChatStateEnvelope
  | NarratorSessionChatMessageEnvelope
  | NarratorSessionChatErrorEnvelope;
