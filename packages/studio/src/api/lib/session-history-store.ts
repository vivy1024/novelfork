import {
  createSessionMessageRepository,
  type StoredSessionMessage,
  type StoredSessionMessageCursor,
  type StoredSessionMessageInput,
} from "@vivy1024/novelfork-core";

import type { NarratorSessionChatMessage, ToolCall } from "../../shared/session-types.js";
import { getSessionStorageDatabase } from "./session-storage.js";

export const historyWriteQueues = new Map<string, Promise<void>>();
const deletedHistorySessions = new Set<string>();

function getMessageRepo() {
  return createSessionMessageRepository(getSessionStorageDatabase());
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toStoredMessage(message: NarratorSessionChatMessage): StoredSessionMessageInput {
  return {
    seq: message.seq,
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.timestamp),
    metadataJson: JSON.stringify(message),
  };
}

function toNarratorMessage(message: StoredSessionMessage): NarratorSessionChatMessage {
  const metadata = safeParseJson<Partial<NarratorSessionChatMessage>>(message.metadataJson, {});
  return {
    ...metadata,
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp.getTime(),
    seq: message.seq,
  };
}

export function markSessionChatHistoryDeleted(sessionId: string): void {
  deletedHistorySessions.add(sessionId);
}

export function isSessionChatHistoryDeleted(sessionId: string): boolean {
  return deletedHistorySessions.has(sessionId);
}

/**
 * Auto-upgrade old session messages that may lack fields newer code expects.
 * Runs once at load time (not on every access) to fill in safe defaults:
 * - Missing `toolCalls` → `[]`
 * - Missing `metadata` → `{}`
 * - Missing `role` → inferred from content/context
 * - Missing `timestamp` → fallback based on message index (caller supplies)
 * - Incomplete toolCall entries get status/duration/input normalized
 */
export function upgradeMessage(msg: NarratorSessionChatMessage, index: number): NarratorSessionChatMessage {
  const upgraded: NarratorSessionChatMessage = {
    ...msg,
    id: msg.id || `legacy-msg-${index}`,
    role: msg.role || inferRole(msg.content),
    content: msg.content ?? "",
    timestamp: typeof msg.timestamp === "number" && msg.timestamp > 0
      ? msg.timestamp
      : index * 1000,
    toolCalls: msg.toolCalls ?? [],
    metadata: msg.metadata ?? {},
  };

  // Normalize individual toolCall entries
  if (upgraded.toolCalls!.length > 0) {
    upgraded.toolCalls = upgraded.toolCalls!.map((tc: ToolCall) => ({
      ...tc,
      status: tc.status ?? (tc.output || tc.result ? "success" : undefined),
      duration: tc.duration ?? undefined,
      input: tc.input ?? undefined,
    }));
  }

  return upgraded;
}

/** Infer role from content when the stored role field is missing/empty. */
function inferRole(content: string | undefined): NarratorSessionChatMessage["role"] {
  if (!content) return "user";
  // Messages starting with tool-related prefixes are likely assistant
  if (content.startsWith("请求调用工具") || content.startsWith("工具")) return "assistant";
  return "user";
}

export async function loadSessionChatHistory(sessionId: string): Promise<NarratorSessionChatMessage[]> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return [];
  }

  return (await getMessageRepo().loadAll(sessionId)).map(toNarratorMessage).map(upgradeMessage);
}

export async function saveSessionChatHistory(sessionId: string, messages: NarratorSessionChatMessage[]): Promise<void> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return;
  }

  await getMessageRepo().replaceAll(sessionId, messages.map(toStoredMessage));
}

export async function appendSessionChatHistory(
  sessionId: string,
  messages: NarratorSessionChatMessage[],
  seedMessages: NarratorSessionChatMessage[] = [],
): Promise<NarratorSessionChatMessage[]> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return [];
  }

  const stored = await getMessageRepo().appendMessages(
    sessionId,
    messages.map(toStoredMessage),
    seedMessages.map(toStoredMessage),
  );
  return stored.map(toNarratorMessage);
}

export async function getSessionChatCursor(sessionId: string): Promise<StoredSessionMessageCursor> {
  return getMessageRepo().getCursor(sessionId);
}

export async function updateSessionChatAckedSeq(
  sessionId: string,
  ackedSeq: number,
  recoveryJson?: string,
): Promise<StoredSessionMessageCursor> {
  return getMessageRepo().updateAckedSeq(sessionId, ackedSeq, recoveryJson);
}

export async function updateSessionChatRecoveryJson(
  sessionId: string,
  recoveryJson: string,
): Promise<StoredSessionMessageCursor> {
  return getMessageRepo().updateRecoveryJson(sessionId, recoveryJson);
}

export async function deleteSessionChatHistory(sessionId: string): Promise<void> {
  markSessionChatHistoryDeleted(sessionId);
  await getMessageRepo().deleteAllBySession(sessionId);
}
