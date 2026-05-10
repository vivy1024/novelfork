/**
 * Pending action store — stores a writing action that should be auto-sent
 * when the conversation page loads.
 */

const STORAGE_KEY = "novelfork:pending-action";

export interface PendingWritingAction {
  sessionId: string;
  actionId: string;
  command: string;
  timestamp: number;
}

const ACTION_COMMAND_MAP: Record<string, string> = {
  "session-native.write-next": "/novel:write-next",
  "ai.draft.async": "/novel:draft",
  "ai.audit": "/novel:audit",
  "ai.detect": "/novel:detect",
  "hooks.generate": "/novel:hooks",
};

export function getCommandForAction(actionId: string): string | null {
  return ACTION_COMMAND_MAP[actionId] ?? null;
}

export function setPendingAction(sessionId: string, actionId: string): void {
  const command = getCommandForAction(actionId);
  if (!command) return;
  const action: PendingWritingAction = { sessionId, actionId, command, timestamp: Date.now() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(action));
  } catch { /* ignore */ }
}

export function consumePendingAction(sessionId: string): PendingWritingAction | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const action: PendingWritingAction = JSON.parse(raw);
    // Only consume if it matches the session and is recent (< 30s)
    if (action.sessionId !== sessionId) return null;
    if (Date.now() - action.timestamp > 30_000) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    sessionStorage.removeItem(STORAGE_KEY);
    return action;
  } catch {
    return null;
  }
}
