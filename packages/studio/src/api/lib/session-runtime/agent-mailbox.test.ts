import { describe, expect, it } from "vitest";

import { BackgroundAgentMailbox } from "./agent-mailbox.js";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("BackgroundAgentMailbox", () => {
  it("queues messages and marks only the next generated batch delivered", () => {
    const mailbox = new BackgroundAgentMailbox();
    const first = mailbox.enqueue("first instruction");
    const second = mailbox.enqueue("second instruction");

    expect(first).toMatchObject({ status: "queued" });
    expect(second).toMatchObject({ status: "queued" });
    expect(first.id).toMatch(uuidV4Pattern);
    expect(second.id).toMatch(uuidV4Pattern);

    const delivered = mailbox.drainForNextGenerate();

    expect(delivered.map((message) => ({ content: message.content, status: message.status }))).toEqual([
      { content: "first instruction", status: "delivered" },
      { content: "second instruction", status: "delivered" },
    ]);
    expect(mailbox.drainForNextGenerate()).toEqual([]);
    expect(mailbox.snapshot().map((message) => message.status)).toEqual(["delivered", "delivered"]);
  });

  it("marks messages arriving during the last generate undelivered at terminal", () => {
    const mailbox = new BackgroundAgentMailbox();
    const delivered = mailbox.enqueue("included before generate");
    mailbox.drainForNextGenerate();
    const late = mailbox.enqueue("arrived during final generate");

    const undelivered = mailbox.markUndeliveredOnTerminal();

    expect(undelivered).toEqual([
      expect.objectContaining({ id: late.id, content: "arrived during final generate", status: "undelivered" }),
    ]);
    expect(mailbox.snapshot()).toEqual([
      expect.objectContaining({ id: delivered.id, status: "delivered" }),
      expect.objectContaining({ id: late.id, status: "undelivered" }),
    ]);
    expect(mailbox.enqueue("after terminal")).toEqual({ status: "not-running" });
  });
});
