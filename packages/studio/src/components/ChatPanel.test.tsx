import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "./ChatPanel";

describe("ChatPanel persistence status", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ messages: [], persistence: "process-memory" }),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows that lightweight chat history is only kept in the current process", async () => {
    render(<ChatPanel bookId="book-1" />);

    expect(await screen.findByText("当前进程临时历史")).toBeTruthy();
    expect(screen.getByText(/刷新或重启后可能丢失/)).toBeTruthy();
  });
});
