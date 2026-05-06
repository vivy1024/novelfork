import { useMemo, useState } from "react";

import type { BackendCapability } from "../backend-contract/capability-status";
import { listWritingActionDescriptors, type SessionDomainClient, type WritingActionDescriptor } from "../backend-contract/writing-action-adapter";
import type { ContractResult } from "../backend-contract";
import type { CreateNarratorSessionInput, NarratorSessionRecord } from "../../shared/session-types";

export interface WorkbenchWritingAction {
  id: string;
  label: string;
  description?: string;
  capability?: BackendCapability;
  disabled?: boolean;
  disabledReason?: string;
}

export interface WorkbenchWritingActionsSessionClient {
  readonly listActiveSessions: SessionDomainClient["listActiveSessions"];
  readonly createSession: (payload: CreateNarratorSessionInput) => Promise<ContractResult<NarratorSessionRecord>>;
}

export interface WorkbenchWritingActionsProps {
  bookId: string;
  sessions: WorkbenchWritingActionsSessionClient;
  actions?: readonly WorkbenchWritingAction[];
  blockedReason?: string;
  onNavigateToConversation: (sessionId: string, action: WorkbenchWritingAction) => void;
}

const actionLabelOverrides: Record<string, string> = {
  "session-native.write-next": "生成下一章",
  "ai.draft.async": "续写草稿",
  "writing-modes.preview": "扩写/改写",
  "ai.audit": "连续性审校",
  "ai.detect": "去 AI 味检测",
  "hooks.generate": "伏笔建议",
};

const defaultActionIds = Object.keys(actionLabelOverrides);

export function buildDefaultWorkbenchWritingActions(descriptors: readonly WritingActionDescriptor[] = listWritingActionDescriptors()): WorkbenchWritingAction[] {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  return defaultActionIds.flatMap((id) => {
    const descriptor = byId.get(id);
    if (!descriptor) return [];
    return [{ id, label: actionLabelOverrides[id], description: descriptor.entry, capability: descriptor.capability }];
  });
}

function isDisabled(action: WorkbenchWritingAction): boolean {
  return action.disabled === true || action.capability?.ui.disabled === true || action.capability?.ui.allowsFormalWrite === false;
}

function getDisabledReason(action: WorkbenchWritingAction): string | null {
  if (action.disabledReason) return action.disabledReason;
  if (action.capability?.ui.allowsFormalWrite === false && action.capability.ui.previewOnly) {
    return "当前能力仅提供 Prompt 预览，需要用户显式复制或应用。";
  }
  return action.capability?.ui.disabledReason ?? null;
}

function normalizeSessionList(data: unknown): NarratorSessionRecord[] {
  if (Array.isArray(data)) return data as NarratorSessionRecord[];
  if (data && typeof data === "object") {
    const record = data as { sessions?: unknown; items?: unknown };
    if (Array.isArray(record.sessions)) return record.sessions as NarratorSessionRecord[];
    if (Array.isArray(record.items)) return record.items as NarratorSessionRecord[];
  }
  return [];
}

function extractSessionId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as { ok?: boolean; data?: unknown; id?: unknown; sessionId?: unknown };
  if (record.ok === true) return extractSessionId(record.data);
  if (typeof record.id === "string") return record.id;
  if (typeof record.sessionId === "string") return record.sessionId;
  return null;
}

async function ensureWorkbenchSession(bookId: string, action: WorkbenchWritingAction, sessions: WorkbenchWritingActionsProps["sessions"]): Promise<string> {
  const existing = await sessions.listActiveSessions({ binding: `book:${bookId}` });
  if (existing.ok) {
    const reusable = normalizeSessionList(existing.data).find((session) => session.status !== "archived");
    if (reusable?.id) return reusable.id;
  }

  const payload: CreateNarratorSessionInput = {
    title: `《${bookId}》${action.label}`,
    agentId: "writer",
    kind: "standalone",
    sessionMode: "chat",
    projectId: bookId,
  };
  const created = await sessions.createSession(payload);
  const sessionId = extractSessionId(created);
  if (!sessionId) throw new Error("未能创建写作工作台会话");
  return sessionId;
}

export function WorkbenchWritingActions({ bookId, sessions, actions, blockedReason, onNavigateToConversation }: WorkbenchWritingActionsProps) {
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedActions = useMemo(() => actions ?? buildDefaultWorkbenchWritingActions(), [actions]);

  async function runAction(action: WorkbenchWritingAction) {
    if (blockedReason || isDisabled(action) || runningActionId) return;
    setRunningActionId(action.id);
    setError(null);
    try {
      const sessionId = await ensureWorkbenchSession(bookId, action, sessions);
      onNavigateToConversation(sessionId, action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "写作动作启动失败");
    } finally {
      setRunningActionId(null);
    }
  }

  return (
    <section className="workbench-writing-actions" aria-label="写作动作入口">
      {error ? <p role="alert">{error}</p> : null}
      {resolvedActions.map((action) => {
        const disabled = Boolean(blockedReason) || isDisabled(action);
        const disabledReason = blockedReason ?? getDisabledReason(action);
        return (
          <div key={action.id} className="workbench-writing-actions__item">
            <button type="button" disabled={disabled || runningActionId !== null} onClick={() => void runAction(action)}>
              {runningActionId === action.id ? "启动中…" : action.label}
            </button>
            {action.description ? <small>{action.description}</small> : null}
            {disabled && disabledReason ? <p>{disabledReason}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
