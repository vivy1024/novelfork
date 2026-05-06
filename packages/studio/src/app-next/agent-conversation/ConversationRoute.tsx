import type { ReactNode } from "react";

import type { CanvasContext } from "../../shared/agent-native-workspace";
import type { ToolResultArtifact } from "../tool-results";
import type { NarratorSessionMode } from "../../shared/session-types";
import type { SlashCommandCompactResult } from "./slash-command-registry";
import { buildAbortEnvelope, buildMessageEnvelope } from "./runtime";
import {
  ConversationSurface,
  type ConversationConfirmation,
  type ConversationRecoveryNotice,
  type ConversationSessionConfigPatch,
  type ConversationStatus,
  type ConversationSurfaceMessage,
} from "./surface";

export type ConversationRouteMessage = ConversationSurfaceMessage;
export type ConversationRouteStatus = ConversationStatus;
export type ConversationRouteConfirmation = ConversationConfirmation;

export type ConversationRouteClientEnvelope = ReturnType<typeof buildMessageEnvelope> | ReturnType<typeof buildAbortEnvelope>;

export interface ConversationRouteProps {
  sessionId?: string;
  title?: string;
  sessionMode?: NarratorSessionMode;
  initialAck?: number;
  canvasContext?: CanvasContext;
  initialMessages?: readonly ConversationRouteMessage[];
  initialStatus?: ConversationRouteStatus;
  initialConfirmation?: ConversationRouteConfirmation | null;
  initialRecoveryNotice?: ConversationRecoveryNotice | null;
  sendDisabledReason?: string;
  settingsHref?: string;
  footerActions?: ReactNode;
  createMessageId?: () => string;
  onClientEnvelope?: (envelope: ConversationRouteClientEnvelope) => void;
  onSendMessage?: (content: string) => void;
  onAbortSession?: () => void;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
  onCompactSession?: (instructions?: string) => Promise<SlashCommandCompactResult>;
  onApproveConfirmation?: (id: string) => void;
  onRejectConfirmation?: (id: string) => void;
  onOpenArtifact?: (artifact: ToolResultArtifact) => void;
}

const defaultStatus: ConversationRouteStatus = { state: "idle", label: "未连接" };

function createDefaultMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}`;
}

export function ConversationRoute({
  sessionId,
  title = "叙述者",
  sessionMode,
  initialAck,
  canvasContext,
  initialMessages = [],
  initialStatus = defaultStatus,
  initialConfirmation = null,
  initialRecoveryNotice = null,
  sendDisabledReason,
  settingsHref,
  footerActions = null,
  createMessageId = createDefaultMessageId,
  onClientEnvelope = () => undefined,
  onSendMessage,
  onAbortSession,
  onUpdateSessionConfig = () => undefined,
  onCompactSession,
  onApproveConfirmation = () => undefined,
  onRejectConfirmation = () => undefined,
  onOpenArtifact,
}: ConversationRouteProps) {
  if (!sessionId) {
    return (
      <section data-testid="conversation-route-empty" className="conversation-route conversation-route--empty">
        <h2>选择或新建叙述者会话</h2>
        <p>请从 shell 会话列表选择一个会话，或创建新会话后开始对话。</p>
      </section>
    );
  }

  const handleSend = (content: string) => {
    if (onSendMessage) {
      onSendMessage(content);
      return;
    }

    onClientEnvelope(
      buildMessageEnvelope({
        sessionId,
        messageId: createMessageId(),
        content,
        sessionMode,
        ack: initialAck,
        canvasContext,
      }),
    );
  };

  const handleAbort = () => {
    if (onAbortSession) {
      onAbortSession();
      return;
    }

    onClientEnvelope(buildAbortEnvelope({ sessionId }));
  };

  return (
    <section data-testid="conversation-route" className="conversation-route" data-session-id={sessionId}>
      <ConversationSurface
        title={title}
        status={initialStatus}
        messages={initialMessages}
        pendingConfirmation={initialConfirmation}
        recoveryNotice={initialRecoveryNotice}
        isRunning={initialStatus.state === "running"}
        sendDisabledReason={sendDisabledReason}
        settingsHref={settingsHref}
        footerActions={footerActions}
        onApproveConfirmation={onApproveConfirmation}
        onRejectConfirmation={onRejectConfirmation}
        onSend={handleSend}
        onAbort={handleAbort}
        onUpdateSessionConfig={onUpdateSessionConfig}
        onCompactSession={onCompactSession}
        onOpenArtifact={onOpenArtifact}
      />
    </section>
  );
}
