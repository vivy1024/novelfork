import { describe, expect, it } from "vitest";

import { resolveStudioNextRoute } from "./entry";

describe("Studio Next entry resolver", () => {
  it("derives supported Agent Shell routes from the URL", () => {
    expect(resolveStudioNextRoute("/next")).toEqual({ kind: "home" });
    expect(resolveStudioNextRoute("/next/narrators/s1")).toEqual({ kind: "narrator", sessionId: "s1" });
    expect(resolveStudioNextRoute("/next/books/b1")).toEqual({ kind: "book", bookId: "b1" });
    expect(resolveStudioNextRoute("/next/search")).toEqual({ kind: "search" });
    expect(resolveStudioNextRoute("/next/routines")).toEqual({ kind: "routines" });
    expect(resolveStudioNextRoute("/next/settings")).toEqual({ kind: "settings" });
    expect(resolveStudioNextRoute("/next/unknown")).toEqual({ kind: "home" });
  });
});
