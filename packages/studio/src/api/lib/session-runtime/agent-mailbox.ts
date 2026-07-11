import { randomUUID } from "node:crypto";

export type MailboxMessageStatus = "queued" | "delivered" | "undelivered";

export interface MailboxMessage {
  readonly id: string;
  readonly content: string;
  status: MailboxMessageStatus;
  readonly queuedAt: number;
  deliveredAt?: number;
  terminalAt?: number;
}

export type MailboxEnqueueResult =
  | { readonly id: string; readonly status: "queued" }
  | { readonly status: "not-running" };

function snapshotMessage(message: MailboxMessage): MailboxMessage {
  return { ...message };
}

/**
 * In-memory mailbox for one background Agent resource. A message is only
 * "delivered" when it is drained into the next provider generate input.
 */
export class BackgroundAgentMailbox {
  readonly #messages: MailboxMessage[] = [];
  #accepting = true;

  enqueue(content: string): MailboxEnqueueResult {
    if (!this.#accepting) {
      return { status: "not-running" };
    }
    const message: MailboxMessage = {
      id: randomUUID(),
      content,
      status: "queued",
      queuedAt: Date.now(),
    };
    this.#messages.push(message);
    return { id: message.id, status: "queued" };
  }

  drainForNextGenerate(): MailboxMessage[] {
    if (!this.#accepting) {
      return [];
    }
    const deliveredAt = Date.now();
    const delivered: MailboxMessage[] = [];
    for (const message of this.#messages) {
      if (message.status !== "queued") continue;
      message.status = "delivered";
      message.deliveredAt = deliveredAt;
      delivered.push(snapshotMessage(message));
    }
    return delivered;
  }

  markUndeliveredOnTerminal(): MailboxMessage[] {
    this.#accepting = false;
    const terminalAt = Date.now();
    const undelivered: MailboxMessage[] = [];
    for (const message of this.#messages) {
      if (message.status !== "queued") continue;
      message.status = "undelivered";
      message.terminalAt = terminalAt;
      undelivered.push(snapshotMessage(message));
    }
    return undelivered;
  }

  snapshot(): MailboxMessage[] {
    return this.#messages.map(snapshotMessage);
  }
}
