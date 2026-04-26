import {
  createSessionMessageRepository,
  type StoredSessionMessage,
  type StoredSessionMessageCursor,
  type StoredSessionMessageInput,
} from "@vivy1024/novelfork-core";

import type { NarratorSessionChatMessage } from "../../shared/session-types.js";
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

export async function loadSessionChatHistory(sessionId: string): Promise<NarratorSessionChatMessage[]> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return [];
  }

  return (await getMessageRepo().loadAll(sessionId)).map(toNarratorMessage);
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
