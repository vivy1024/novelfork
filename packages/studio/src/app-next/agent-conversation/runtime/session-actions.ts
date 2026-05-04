import type { CanvasContext } from "../../../shared/agent-native-workspace";

export interface BuildMessageEnvelopeInput {
  sessionId: string;
  messageId: string;
  content: string;
  sessionMode?: string;
  ack?: number;
  canvasContext?: CanvasContext;
}

export function buildMessageEnvelope(input: BuildMessageEnvelopeInput) {
  return {
    type: "session:message" as const,
    sessionId: input.sessionId,
    messageId: input.messageId,
    content: input.content,
    sessionMode: input.sessionMode,
    ack: input.ack,
    canvasContext: input.canvasContext,
  };
}

export function buildAckEnvelope(input: { sessionId: string; ack: number }) {
  return {
    type: "session:ack" as const,
    sessionId: input.sessionId,
    ack: input.ack,
  };
}

export function buildAbortEnvelope(input: { sessionId: string }) {
  return {
    type: "session:abort" as const,
    sessionId: input.sessionId,
  };
}
