import { Hono } from "hono";

import {
  buildUnsupportedCapabilityResponse,
  normalizeRuntimeCapabilityStatus,
  normalizeUnsupportedCapabilityHttpStatus,
} from "../../lib/runtime-capabilities.js";

export function createRuntimeCapabilitiesRouter() {
  const app = new Hono();

  app.get("/unsupported/:capability", (c) => {
    const capability = c.req.param("capability");
    const status = normalizeRuntimeCapabilityStatus(c.req.query("status"));
    const httpStatus = normalizeUnsupportedCapabilityHttpStatus(c.req.query("httpStatus"));
    const reason = c.req.query("reason");

    return c.json(buildUnsupportedCapabilityResponse(capability, { status, reason }), httpStatus);
  });

  return app;
}
