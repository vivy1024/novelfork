import { describe, expect, it } from "vitest";

import { resolveStudioEntryMode, resolveStudioNextRoute } from "./entry";

describe("Studio Next entry resolver", () => {
  it("routes /next and nested /next paths to the isolated Studio Next entry", () => {
    expect(resolveStudioEntryMode("/next")).toBe("next");
    expect(resolveStudioEntryMode("/next/")).toBe("next");
    expect(resolveStudioEntryMode("/next/settings")).toBe("next");
    expect(resolveStudioEntryMode("/next/routines")).toBe("next");
  });

  it("keeps non-next paths on the legacy Studio entry", () => {
    expect(resolveStudioEntryMode("/")).toBe("legacy");
    expect(resolveStudioEntryMode("/books/demo")).toBe("legacy");
  });

  it("derives the first-phase Studio Next page from the URL", () => {
    expect(resolveStudioNextRoute("/next")).toBe("workspace");
    expect(resolveStudioNextRoute("/next/settings")).toBe("settings");
    expect(resolveStudioNextRoute("/next/routines")).toBe("routines");
    expect(resolveStudioNextRoute("/next/unknown")).toBe("workspace");
  });
});
