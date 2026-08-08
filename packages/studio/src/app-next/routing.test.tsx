import { describe, expect, it } from "vitest";

import { resolveStudioNextRoute } from "./entry";

describe("Studio Next routing", () => {
  it("resolves sub-routes within the product entry", () => {
    expect(resolveStudioNextRoute("/next")).toEqual({ kind: "home" });
    expect(resolveStudioNextRoute("/next/narrators/s1")).toEqual({ kind: "narrator", sessionId: "s1" });
    expect(resolveStudioNextRoute("/next/books/b1")).toEqual({ kind: "book", bookId: "b1" });
    expect(resolveStudioNextRoute("/next/settings")).toEqual({ kind: "settings" });
    expect(resolveStudioNextRoute("/next/settings/providers")).toEqual({ kind: "settings", section: "providers" });
    expect(resolveStudioNextRoute("/next/routines")).toEqual({ kind: "routines" });
    expect(resolveStudioNextRoute("/next/knowledge")).toEqual({ kind: "knowledge" });
    expect(resolveStudioNextRoute("/next/scheduled-tasks")).toEqual({ kind: "scheduled-tasks" });
    expect(resolveStudioNextRoute("/next/search")).toEqual({ kind: "search" });
    expect(resolveStudioNextRoute("/next/unknown")).toEqual({ kind: "home" });
  });
});
