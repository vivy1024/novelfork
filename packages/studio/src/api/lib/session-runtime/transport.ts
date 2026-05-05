import type {
  NarratorSessionChatClientMessage,
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

export function parseSessionClientMessage(text: string): NarratorSessionChatClientMessage {
  try {
    const parsed = JSON.parse(text) as Partial<NarratorSessionChatClientMessage> | string;
    if (typeof parsed === "string") {
      return { content: parsed };
    }
    if (parsed?.type === "session:ack") {
      return {
        type: "session:ack",
        sessionId: parsed.sessionId,
        ack: sanitizeSeq((parsed as { ack?: unknown }).ack),
      };
    }
    if (parsed?.type === "session:abort") {
      return {
        type: "session:abort",
        sessionId: (parsed as { sessionId?: string }).sessionId,
      };
    }
    if (parsed && typeof (parsed as { content?: unknown }).content === "string") {
      return {
        ...(parsed as Record<string, unknown>),
        content: (parsed as { content: string }).content,
        ack: sanitizeSeq((parsed as { ack?: unknown }).ack),
      } as NarratorSessionChatClientMessage;
    }
  } catch {
    // Treat raw text as a chat message payload.
  }

  return { content: text };
}
