import { describe, expect, it } from "vitest";

import {
  ApiError,
  buildApiErrorResponse,
  buildProviderFailureEnvelope,
  buildStructuredErrorEnvelope,
  buildUnsupportedCapabilityFailure,
  getProviderFailureHttpStatus,
} from "./errors";

describe("api error and status helpers", () => {
  it("serializes ApiError without changing the existing structured route shape", () => {
    const error = new ApiError(400, "INVALID_BOOK_ID", "Invalid book ID");

    expect(buildApiErrorResponse(error)).toEqual({
      status: 400,
      body: {
        error: {
          code: "INVALID_BOOK_ID",
          message: "Invalid book ID",
        },
      },
    });
  });

  it("preserves code, message, capability and gate in structured error envelopes", () => {
    const gate = { ok: false, reason: "model-not-configured" };

    expect(buildStructuredErrorEnvelope({
      code: "MODEL_NOT_CONFIGURED",
      message: "未配置可用模型。",
      capability: "hooks.generate",
      gate,
      mirrorCode: true,
    })).toEqual({
      error: {
        code: "MODEL_NOT_CONFIGURED",
        message: "未配置可用模型。",
      },
      code: "MODEL_NOT_CONFIGURED",
      capability: "hooks.generate",
      gate,
    });
  });

  it("maps provider adapter failures to the canonical status and envelope", () => {
    expect(getProviderFailureHttpStatus({ success: false, code: "unsupported", error: "not wired" })).toBe(501);
    expect(getProviderFailureHttpStatus({ success: false, code: "auth-missing", error: "missing key" })).toBe(422);
    expect(getProviderFailureHttpStatus({ success: false, code: "config-missing", error: "missing base url" })).toBe(422);
    expect(getProviderFailureHttpStatus({ success: false, code: "upstream-error", error: "bad upstream" })).toBe(502);
    expect(getProviderFailureHttpStatus({ success: false, code: "network-error", error: "offline" })).toBe(502);
    expect(getProviderFailureHttpStatus({ success: false, code: "unknown", error: "unknown" })).toBe(500);

    expect(buildProviderFailureEnvelope({
      success: false,
      code: "unsupported",
      error: "Capability unsupported: anthropic-compatible.listModels",
      capability: "anthropic-compatible.listModels",
    })).toEqual({
      success: false,
      code: "unsupported",
      error: "Capability unsupported: anthropic-compatible.listModels",
      capability: "anthropic-compatible.listModels",
    });
  });

  it("builds unsupported capability failures without fake success", () => {
    expect(buildUnsupportedCapabilityFailure("platform.cline.json-import")).toEqual({
      success: false,
      code: "unsupported",
      capability: "platform.cline.json-import",
      error: "Capability unsupported: platform.cline.json-import",
    });
  });
});
