import type { NarratorSessionChatMessage, NarratorSessionChatSnapshot, NarratorSessionRecord } from "../../shared/session-types.js";
import { getSessionChatSnapshot, replaceSessionChatState } from "./session-chat-service.js";
import { createSession, deleteSession, getSessionById, listSessions, updateSession } from "./session-service.js";

export type SessionLifecycleErrorCode = "session_not_found" | "source_session_not_found";

export type SessionLifecycleFailure = {
  readonly ok: false;
  readonly status: 404;
  readonly code: SessionLifecycleErrorCode;
  readonly error: string;
};

export type SessionLifecycleSuccess = {
  readonly ok: true;
  readonly session: NarratorSessionRecord;
  readonly snapshot: NarratorSessionChatSnapshot;
  readonly readonly: boolean;
};

export type ContinueLatestSessionOptions = {
  readonly projectId?: string;
  readonly chapterId?: string;
};

export type ForkSessionInput = {
  readonly sourceSessionId: string;
  readonly title?: string;
  readonly inheritanceNote?: string;
};

function sessionNotFound(): SessionLifecycleFailure {
  return { ok: false, status: 404, code: "session_not_found", error: "Session not found" };
}

function sourceSessionNotFound(): SessionLifecycleFailure {
  return { ok: false, status: 404, code: "source_session_not_found", error: "Source session not found" };
}

async function openSession(session: NarratorSessionRecord, readonly: boolean): Promise<SessionLifecycleSuccess | SessionLifecycleFailure> {
  const snapshot = await getSessionChatSnapshot(session.id);
  if (!snapshot) {
    return sessionNotFound();
  }
  return {
    ok: true,
    session: snapshot.session,
    snapshot,
    readonly,
  };
}

export async function continueLatestSession(options: ContinueLatestSessionOptions = {}): Promise<SessionLifecycleSuccess | SessionLifecycleFailure> {
  const sessions = await listSessions({
    status: "active",
    sort: "recent",
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.chapterId ? { chapterId: options.chapterId } : {}),
  });
  const latest = sessions[0];
  if (!latest) {
    return sessionNotFound();
  }
  return openSession(latest, false);
}

export async function resumeSession(sessionId: string): Promise<SessionLifecycleSuccess | SessionLifecycleFailure> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return sessionNotFound();
  }
  return openSession(session, session.status === "archived");
}

export async function restoreSessionForContinue(sessionId: string): Promise<SessionLifecycleSuccess | SessionLifecycleFailure> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return sessionNotFound();
  }
  const activeSession = session.status === "archived" ? await updateSession(session.id, { status: "active" }) : session;
  if (!activeSession) {
    return sessionNotFound();
  }
  return openSession(activeSession, false);
}

function buildForkSummaryMessage(source: NarratorSessionRecord, sourceSnapshot: NarratorSessionChatSnapshot | null, inheritanceNote?: string): NarratorSessionChatMessage {
  const sourceMessages = sourceSnapshot?.messages ?? source.recentMessages ?? [];
  const sourceMessageCount = sourceMessages.length;
  const lastMessages = sourceMessages.slice(-3).map((item) => `${item.role}: ${item.content.trim()}`).filter(Boolean);
  const context = lastMessages.length > 0 ? `\n最近上下文：\n${lastMessages.join("\n")}` : "";
  const note = inheritanceNote?.trim() ? `\n继承说明：${inheritanceNote.trim()}` : "";
  return {
    id: `fork-summary-${crypto.randomUUID()}`,
    role: "system",
    content: `本会话 fork 自 ${source.id}（${source.title}），源会话包含 ${sourceMessageCount} 条历史消息。请继承源会话的书籍/章节绑定、模型配置与必要上下文，但不要复用源 sessionId。${note}${context}`,
    timestamp: Date.now(),
    metadata: {
      kind: "session-fork-summary",
      sourceSessionId: source.id,
      sourceTitle: source.title,
      sourceMessageCount,
    },
  };
}

export async function forkSession(input: ForkSessionInput): Promise<SessionLifecycleSuccess | SessionLifecycleFailure> {
  const source = await getSessionById(input.sourceSessionId);
  if (!source) {
    return sourceSessionNotFound();
  }

  const forked = await createSession({
    title: input.title?.trim() || `${source.title} fork`,
    agentId: source.agentId,
    kind: source.kind,
    sessionMode: source.sessionMode,
    worktree: source.worktree,
    projectId: source.projectId,
    chapterId: source.chapterId,
    sessionConfig: source.sessionConfig,
  });
  const sourceSnapshot = await getSessionChatSnapshot(source.id);
  const forkSnapshot = await replaceSessionChatState(forked.id, [buildForkSummaryMessage(source, sourceSnapshot, input.inheritanceNote)]);
  if (!forkSnapshot) {
    await deleteSession(forked.id);
    return sessionNotFound();
  }

  return {
    ok: true,
    session: forkSnapshot.session,
    snapshot: forkSnapshot,
    readonly: false,
  };
}
