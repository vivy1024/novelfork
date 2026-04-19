/**
 * useSession — Session management with IndexedDB persistence
 */

import { useState, useEffect, useCallback } from "react";

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  lastModified: Date;
  messageCount: number;
  model: string;
  worktree?: string;
}

const DB_NAME = "novelfork-studio";
const DB_VERSION = 2;
const SESSION_STORE = "sessions";

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const store = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
        store.createIndex("lastModified", "lastModified", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllSessions(): Promise<Session[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, "readonly");
      const store = tx.objectStore(SESSION_STORE);
      const index = store.index("lastModified");
      const req = index.openCursor(null, "prev");
      const sessions: Session[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const session = cursor.value;
          sessions.push({
            ...session,
            createdAt: new Date(session.createdAt),
            lastModified: new Date(session.lastModified),
          });
          cursor.continue();
        } else {
          resolve(sessions);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function getSession(id: string): Promise<Session | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, "readonly");
      const req = tx.objectStore(SESSION_STORE).get(id);
      req.onsuccess = () => {
        const session = req.result;
        if (session) {
          resolve({
            ...session,
            createdAt: new Date(session.createdAt),
            lastModified: new Date(session.lastModified),
          });
        } else {
          resolve(undefined);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function saveSession(session: Session): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.objectStore(SESSION_STORE).put({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastModified: session.lastModified.toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently degrade
  }
}

async function deleteSession(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.objectStore(SESSION_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently degrade
  }
}

async function updateSessionOrder(sessions: Session[]): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      const store = tx.objectStore(SESSION_STORE);
      sessions.forEach((session, index) => {
        store.put({
          ...session,
          createdAt: session.createdAt.toISOString(),
          lastModified: new Date(Date.now() - index).toISOString(),
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silently degrade
  }
}

// --- Hook ---

export function useSession() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAllSessions().then((data) => {
      setSessions(data);
      setLoaded(true);
    });
  }, []);

  const createSession = useCallback(
    async (title: string, model: string, worktree?: string) => {
      const session: Session = {
        id: crypto.randomUUID(),
        title,
        createdAt: new Date(),
        lastModified: new Date(),
        messageCount: 0,
        model,
        worktree,
      };
      await saveSession(session);
      setSessions((prev) => [session, ...prev]);
      return session;
    },
    []
  );

  const loadSession = useCallback(async (id: string) => {
    const session = await getSession(id);
    if (session) {
      setCurrentSessionId(id);
      session.lastModified = new Date();
      await saveSession(session);
      setSessions((prev) =>
        [session, ...prev.filter((s) => s.id !== id)]
      );
    }
    return session;
  }, []);

  const renameSession = useCallback(async (id: string, newTitle: string) => {
    const session = await getSession(id);
    if (session) {
      session.title = newTitle;
      session.lastModified = new Date();
      await saveSession(session);
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? session : s))
      );
    }
  }, []);

  const removeSession = useCallback(async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
    }
  }, [currentSessionId]);

  const updateSession = useCallback(
    async (id: string, updates: Partial<Session>) => {
      const session = await getSession(id);
      if (session) {
        const updated = { ...session, ...updates, lastModified: new Date() };
        await saveSession(updated);
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? updated : s))
        );
      }
    },
    []
  );

  const reorderSessions = useCallback(async (newOrder: Session[]) => {
    setSessions(newOrder);
    await updateSessionOrder(newOrder);
  }, []);

  const exportSession = useCallback(async (id: string) => {
    const session = await getSession(id);
    if (session) {
      const json = JSON.stringify(session, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session-${session.title}-${session.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
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
