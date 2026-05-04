import type { CanvasContext } from "../../shared/agent-native-workspace";
import type { NarratorSessionMode } from "../../shared/session-types";
import { buildAbortEnvelope, buildMessageEnvelope } from "./runtime";
import {
  ConversationSurface,
  type ConversationConfirmation,
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
  createMessageId?: () => string;
  onClientEnvelope?: (envelope: ConversationRouteClientEnvelope) => void;
  onUpdateSessionConfig?: (patch: ConversationSessionConfigPatch) => Promise<void> | void;
  onApproveConfirmation?: (id: string) => void;
  onRejectConfirmation?: (id: string) => void;
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
  createMessageId = createDefaultMessageId,
  onClientEnvelope = () => undefined,
  onUpdateSessionConfig = () => undefined,
  onApproveConfirmation = () => undefined,
  onRejectConfirmation = () => undefined,
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
    onClientEnvelope(buildAbortEnvelope({ sessionId }));
  };

  return (
    <section data-testid="conversation-route" className="conversation-route" data-session-id={sessionId}>
      <ConversationSurface
        title={title}
        status={initialStatus}
        messages={initialMessages}
        pendingConfirmation={initialConfirmation}
        isRunning={initialStatus.state === "running"}
        onApproveConfirmation={onApproveConfirmation}
        onRejectConfirmation={onRejectConfirmation}
        onSend={handleSend}
        onAbort={handleAbort}
        onUpdateSessionConfig={onUpdateSessionConfig}
      />
    </section>
  );
}
