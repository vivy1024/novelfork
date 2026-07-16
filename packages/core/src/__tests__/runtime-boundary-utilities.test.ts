import { describe, expect, it } from "vitest";

import { ApiError, buildStructuredErrorEnvelope } from "../utils/http-error.js";
import { isSafeBookId } from "../utils/resource-identifiers.js";
import { estimateTokenCount } from "../utils/token-estimator.js";

describe("runtime boundary utilities", () => {
  it("preserves structured HTTP errors across product adapters", () => {
    const error = new ApiError(404, "BOOK_NOT_FOUND", "Book not found");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(404);
    expect(error.code).toBe("BOOK_NOT_FOUND");
    expect(error.message).toBe("Book not found");
  });

  it("builds portable structured error envelopes without a Studio dependency", () => {
    expect(buildStructuredErrorEnvelope({
      code: "MODEL_NOT_CONFIGURED",
      message: "No model is available",
      capability: "hooks.generate",
      gate: { ok: false },
      mirrorCode: true,
    })).toEqual({
      error: { code: "MODEL_NOT_CONFIGURED", message: "No model is available" },
      code: "MODEL_NOT_CONFIGURED",
      capability: "hooks.generate",
      gate: { ok: false },
    });
  });

  it("rejects identifiers that could select arbitrary filesystem paths", () => {
    expect(isSafeBookId("book-01")).toBe(true);
    expect(isSafeBookId(" book-01")).toBe(false);
    expect(isSafeBookId("book/01")).toBe(false);
    expect(isSafeBookId("book\\01")).toBe(false);
    expect(isSafeBookId("../book-01")).toBe(false);
    expect(isSafeBookId("book..01")).toBe(false);
    expect(isSafeBookId("book\0id")).toBe(false);
  });

  it("uses a stable local token estimate for domain budgeting", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("a")).toBe(1);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
  });
});
