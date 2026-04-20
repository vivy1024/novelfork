/**
 * useSession — Session management backed by the server narrator/session API
 */

import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "./use-api";
import type { NarratorSessionRecord } from "../shared/session-types";

export interface Session extends Omit<NarratorSessionRecord, "createdAt" | "lastModified"> {
  createdAt: Date;
  lastModified: Date;
  model: string;
}

function toSession(record: NarratorSessionRecord): Session {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    lastModified: new Date(record.lastModified),
    model: record.sessionConfig.modelId,
  };
}

export function useSession() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchJson<NarratorSessionRecord[]>("/api/sessions")
      .then((data) => setSessions(data.map(toSession)))
      .finally(() => setLoaded(true));
  }, []);

  const createSession = useCallback(async (title: string, model: string, worktree?: string) => {
    const record = await fetchJson<NarratorSessionRecord>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        worktree,
        sessionConfig: { modelId: model },
      }),
    });
    const session = toSession(record);
    setSessions((prev) => [session, ...prev]);
    return session;
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const record = await fetchJson<NarratorSessionRecord>(`/api/sessions/${id}`);
    const session = toSession(record);
    setCurrentSessionId(id);
    setSessions((prev) => [session, ...prev.filter((item) => item.id !== id)]);
    return session;
  }, []);

  const renameSession = useCallback(async (id: string, newTitle: string) => {
    const record = await fetchJson<NarratorSessionRecord>(`/api/sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    const session = toSession(record);
    setSessions((prev) => prev.map((item) => (item.id === id ? session : item)));
  }, []);

  const removeSession = useCallback(async (id: string) => {
    await fetchJson(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((item) => item.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
    }
  }, [currentSessionId]);

  const updateSession = useCallback(async (id: string, updates: Partial<Session>) => {
    const record = await fetchJson<NarratorSessionRecord>(`/api/sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...updates,
        sessionConfig: updates.sessionConfig,
      }),
    });
    const session = toSession(record);
    setSessions((prev) => prev.map((item) => (item.id === id ? session : item)));
  }, []);

  const reorderSessions = useCallback(async (newOrder: Session[]) => {
    const updated = await Promise.all(
      newOrder.map((session, index) =>
        fetchJson<NarratorSessionRecord>(`/api/sessions/${session.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: index }),
        }),
      ),
    );
    setSessions(updated.map(toSession));
  }, []);

  const exportSession = useCallback(async (id: string) => {
    const record = await fetchJson<NarratorSessionRecord>(`/api/sessions/${id}`);
    const json = JSON.stringify(record, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${record.title}-${record.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return {
    sessions,
    currentSessionId,
    loaded,
    createSession,
    loadSession,
    renameSession,
    removeSession,
    updateSession,
    reorderSessions,
    exportSession,
  };
}
