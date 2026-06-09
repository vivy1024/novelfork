import { render, screen } from "@testing-library/react";
import { describe, it, beforeAll } from "vitest";
import { MessageStream } from "./MessageStream";

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

describe("probe", () => {
  it("renders assistant + toolcalls", () => {
    render(<MessageStream messages={[
      { id: "m-user", role: "user", content: "帮我生成第三章" },
      { id: "m-assistant", role: "assistant", content: "我先读取驾驶舱，再给出候选计划。", toolCalls: [
        { id: "tool-1", toolName: "cockpit.get_snapshot", status: "success", summary: "已读取驾驶舱快照", input: { bookId: "book-1" }, result: { ok: true }, durationMs: 42 },
      ]},
    ] as any} />);
    screen.debug(undefined, 100000);
  });
});
