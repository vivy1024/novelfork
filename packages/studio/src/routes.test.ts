import { describe, expect, it } from "vitest";

import { normalizeRoute, sanitizeRestoredTabSession } from "./routes";

describe("normalizeRoute", () => {
  it("accepts the formal project-create route", () => {
    expect(normalizeRoute({ page: "project-create" })).toEqual({ page: "project-create" });
  });
});

describe("sanitizeRestoredTabSession", () => {
  it("maps legacy workflow/admin routes into the grouped shell", () => {
    const session = sanitizeRestoredTabSession({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "agents", route: { page: "agents" } },
        { id: "daemon", route: { page: "daemon" } },
        { id: "book:alpha", route: { page: "book", bookId: "alpha" } },
      ],
      activeTabId: "agents",
    });

    expect(session).toEqual({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "workflow:agents", route: { page: "workflow", section: "agents" } },
        { id: "admin:daemon", route: { page: "admin", section: "daemon" } },
        { id: "book:alpha", route: { page: "book", bookId: "alpha" } },
      ],
      activeTabId: "workflow:agents",
    });
  });

  it("falls back to the first surviving tab when the active route was removed", () => {
    const session = sanitizeRestoredTabSession({
      tabs: [
        { id: "legacy-removed", route: { page: "chat-windows-legacy" } },
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "sessions", route: { page: "sessions" } },
      ],
      activeTabId: "legacy-removed",
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
        { id: "legacy-1", route: { page: "chat-windows-legacy" } },
        { id: "legacy-2", route: { page: "config-legacy" } },
      ],
      activeTabId: "legacy-1",
    });

    expect(session).toBeUndefined();
  });
});
