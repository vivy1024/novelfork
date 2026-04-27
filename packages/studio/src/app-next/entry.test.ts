import { describe, expect, it } from "vitest";

import { resolveStudioNextRoute } from "./entry";

describe("Studio Next entry resolver", () => {
  it("derives the Studio Next page from the URL", () => {
    expect(resolveStudioNextRoute("/next")).toBe("workspace");
    expect(resolveStudioNextRoute("/next/dashboard")).toBe("dashboard");
    expect(resolveStudioNextRoute("/next/settings")).toBe("settings");
    expect(resolveStudioNextRoute("/next/routines")).toBe("routines");
    expect(resolveStudioNextRoute("/next/workflow")).toBe("workflow");
    expect(resolveStudioNextRoute("/next/search")).toBe("search");
    expect(resolveStudioNextRoute("/next/unknown")).toBe("workspace");
  });
});
