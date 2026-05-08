import type { NarratorSessionChatMessage } from "../../shared/session-types.js";
import type { RuntimeEvent } from "./runtime-events.js";

export interface RuntimeTranscriptEnvelope {
  readonly version: 1;
  readonly source: "runtime-turn";
  readonly events: readonly RuntimeEvent[];
}

export function attachRuntimeTranscriptToMessages(
  messages: readonly NarratorSessionChatMessage[],
  events: readonly RuntimeEvent[],
): NarratorSessionChatMessage[] {
  if (messages.length === 0 || events.length === 0) {
    return [...messages];
  }

  const nextMessages = [...messages];
  const targetIndex = Math.max(0, nextMessages.length - 1);
  const target = nextMessages[targetIndex]!;
  const existingTranscript = target.metadata?.runtimeTranscript as RuntimeTranscriptEnvelope | undefined;
  const transcriptEvents = existingTranscript?.events ? [...existingTranscript.events, ...events] : [...events];

  nextMessages[targetIndex] = {
    ...target,
    metadata: {
      ...target.metadata,
      runtimeTranscript: {
        version: 1,
        source: "runtime-turn",
        events: transcriptEvents,
      } satisfies RuntimeTranscriptEnvelope,
    },
  };

  return nextMessages;
}

export function collectRuntimeTranscriptEvents(messages: readonly NarratorSessionChatMessage[]): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  for (const message of messages) {
    const transcript = message.metadata?.runtimeTranscript as RuntimeTranscriptEnvelope | undefined;
    if (!transcript || !Array.isArray(transcript.events)) continue;
    events.push(...transcript.events);
  }
  return events;
}
