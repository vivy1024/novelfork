import { describe, expect, it } from "vitest";

import {
  buildUnsupportedCapabilityResponse,
  isUnsupportedCapabilityHttpStatus,
} from "../../lib/runtime-capabilities";
import { createRuntimeCapabilitiesRouter } from "./runtime-capabilities";

describe("runtime capability unsupported response", () => {
  it("builds the canonical unsupported envelope", () => {
    expect(buildUnsupportedCapabilityResponse("monitor.websocket.events")).toEqual({
      error: "Capability unsupported",
      code: "unsupported",
      capability: "monitor.websocket.events",
      status: "planned",
    });
  });

  it("only treats 501 and 422 as unsupported HTTP statuses", () => {
    expect(isUnsupportedCapabilityHttpStatus(501)).toBe(true);
    expect(isUnsupportedCapabilityHttpStatus(422)).toBe(true);
    expect(isUnsupportedCapabilityHttpStatus(200)).toBe(false);
  });

  it("returns 501 and never 200 success for an unsupported capability route", async () => {
    const app = createRuntimeCapabilitiesRouter();

    const response = await app.request("http://localhost/unsupported/monitor.websocket.events");

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Capability unsupported",
      code: "unsupported",
      capability: "monitor.websocket.events",
      status: "planned",
    });
  });

  it("can return 422 for a known but unavailable capability", async () => {
    const app = createRuntimeCapabilitiesRouter();

    const response = await app.request("http://localhost/unsupported/provider.model.test?httpStatus=422&status=unavailable");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "unsupported",
      capability: "provider.model.test",
      status: "unavailable",
    });
  });
});
