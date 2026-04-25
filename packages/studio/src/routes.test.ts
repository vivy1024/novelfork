import { describe, expect, it } from "vitest";

import { canonicalRouteId, normalizeRoute, validatePersistedTabSession } from "./routes";

describe("Bible route", () => {
  it("normalizes Bible book routes and uses stable tab ids", () => {
    expect(normalizeRoute({ page: "bible", bookId: "demo" })).toEqual({ page: "bible", bookId: "demo" });
    expect(canonicalRouteId({ page: "bible", bookId: "demo" })).toBe("bible:demo");
  });
});

describe("validatePersistedTabSession", () => {
  it("keeps current grouped routes when persisted state is already valid", () => {
    const session = validatePersistedTabSession({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "workflow:agents", route: { page: "workflow", section: "agents" } },
        { id: "admin:daemon", route: { page: "admin", section: "daemon" } },
        { id: "book:alpha", route: { page: "book", bookId: "alpha" } },
      ],
      activeTabId: "workflow:agents",
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

  it("drops invalid persisted routes and falls back to the first surviving tab", () => {
    const session = validatePersistedTabSession({
      tabs: [
        { id: "removed-route", route: { page: "unknown-page" } },
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "sessions", route: { page: "sessions" } },
      ],
      activeTabId: "removed-route",
    });

    expect(session).toEqual({
      tabs: [
        { id: "dashboard", route: { page: "dashboard" } },
        { id: "sessions", route: { page: "sessions" } },
      ],
      activeTabId: "dashboard",
    });
  });

  it("returns undefined when no valid current routes survive", () => {
    const session = validatePersistedTabSession({
      tabs: [
        { id: "invalid-1", route: { page: "unknown-page-a" } },
        { id: "invalid-2", route: { page: "unknown-page-b" } },
      ],
      activeTabId: "invalid-1",
    });

    expect(session).toBeUndefined();
  });
});
