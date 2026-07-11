import type {
  NarratorSessionChatClientMessage,
  NarratorSessionChatMessageClientEnvelope,
  NarratorSessionChatServerEnvelope,
} from "../../../shared/session-types.js";
import { sanitizeSeq } from "./recovery.js";

export interface SessionChatTransport {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export function serializeSessionEnvelope(envelope: NarratorSessionChatServerEnvelope): string {
  return JSON.stringify(envelope);
}

export function sendSessionEnvelope(
  transport: SessionChatTransport,
  envelope: NarratorSessionChatServerEnvelope,
): boolean {
  try {
    transport.send(serializeSessionEnvelope(envelope));
    return true;
  } catch {
    return false;
  }
}

export function normalizeSessionTransportPayload(raw: unknown): Promise<string | null> | string | null {
  if (typeof raw === "string") {
    return raw;
  }

  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    return raw.text();
  }

  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(raw));
  }

  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }

  if (typeof raw === "object" && raw !== null && "toString" in raw) {
    return String(raw);
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseSessionMode(value: unknown): "chat" | "plan" | undefined {
  return value === "chat" || value === "plan" ? value : undefined;
}

function parseImageAttachments(value: unknown): NarratorSessionChatMessageClientEnvelope["attachments"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((attachment) => {
    if (!isRecord(attachment)
      || attachment.type !== "image"
      || typeof attachment.mimeType !== "string"
      || typeof attachment.data !== "string") {
      return [];
    }

    const fileName = optionalString(attachment.fileName);
    return [{
      type: "image" as const,
      mimeType: attachment.mimeType,
      data: attachment.data,
      ...(fileName ? { fileName } : {}),
    }];
  });
}

export function parseSessionClientMessage(text: string): NarratorSessionChatClientMessage {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") {
      return { content: parsed };
    }
    if (!isRecord(parsed)) {
      return { content: text };
    }

    const type = optionalString(parsed.type);
    const sessionId = optionalString(parsed.sessionId);
    if (type === "session:ack") {
      return {
        type: "session:ack",
        ...(sessionId ? { sessionId } : {}),
        ack: sanitizeSeq(parsed.ack),
      };
    }
    if (type === "session:abort") {
      return {
        type: "session:abort",
        ...(sessionId ? { sessionId } : {}),
      };
    }
    if (type === "session:continue") {
      return {
        type: "session:continue",
        ...(sessionId ? { sessionId } : {}),
      };
    }
    if (type === "session:safety-decision") {
      const decision = optionalString(parsed.decision);
      return {
        type: "session:safety-decision",
        ...(sessionId ? { sessionId } : {}),
        decision: decision === "approve" || decision === "reject" ? decision : "reject",
      };
    }
    if (typeof parsed.content === "string") {
      const message: NarratorSessionChatMessageClientEnvelope = {
        content: parsed.content,
        ack: sanitizeSeq(parsed.ack),
      };
      const messageId = optionalString(parsed.messageId);
      const sessionMode = parseSessionMode(parsed.sessionMode);
      const attachments = parseImageAttachments(parsed.attachments);
      if (type === "session:message") message.type = "session:message";
      if (sessionId) message.sessionId = sessionId;
      if (messageId) message.messageId = messageId;
      if (sessionMode) message.sessionMode = sessionMode;
      if (isRecord(parsed.canvasContext)) {
        message.canvasContext = parsed.canvasContext as NarratorSessionChatMessageClientEnvelope["canvasContext"];
      }
      if (attachments) message.attachments = attachments;
      return message;
    }
  } catch {
    // Treat raw text as a chat message payload.
  }

  return { content: text };
}
