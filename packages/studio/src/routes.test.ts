import { describe, expect, it } from "vitest";

import { sanitizeRestoredTabSession } from "./routes";

describe("sanitizeRestoredTabSession", () => {
  it("drops removed legacy routes and keeps supported pages", () => {
    const session = sanitizeRestoredTabSession({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "workflow", route: { page: "workflow" } },
        { id: "agents", route: { page: "agents" } },
        { id: "config", route: { page: "config" } },
        { id: "book:alpha", route: { page: "book", bookId: "alpha" } },
      ],
      activeTabId: "workflow",
    });

    expect(session).toEqual({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "workflow", route: { page: "workflow" } },
        { id: "book:alpha", route: { page: "book", bookId: "alpha" } },
      ],
      activeTabId: "workflow",
    });
  });

  it("falls back to the first surviving tab when the active route was removed", () => {
    const session = sanitizeRestoredTabSession({
      tabs: [
        { id: "agents", route: { page: "agents" } },
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "sessions", route: { page: "sessions" } },
      ],
      activeTabId: "agents",
    });

    expect(session).toEqual({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "sessions", route: { page: "sessions" } },
      ],
      activeTabId: "dashboard",
    });
  });

  it("returns undefined when no supported routes survive", () => {
    const session = sanitizeRestoredTabSession({
      tabs: [
        { id: "agents", route: { page: "agents" } },
        { id: "config", route: { page: "config" } },
      ],
      activeTabId: "agents",
    });

    expect(session).toBeUndefined();
  });
});
