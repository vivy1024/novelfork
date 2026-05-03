import { Hono } from "hono";
import type { StateManager, StorageDatabase } from "@vivy1024/novelfork-core";

import { createNarrativeLineService } from "../lib/narrative-line-service.js";

export interface CreateNarrativeLineRouterOptions {
  readonly state: StateManager;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createNarrativeLineRouter(options: CreateNarrativeLineRouterOptions): Hono {
  const app = new Hono();
  const service = createNarrativeLineService(options);

  app.get("/api/books/:bookId/narrative-line", async (c) => {
    const bookId = c.req.param("bookId");
    const includeWarnings = c.req.query("includeWarnings") !== "false";
    const snapshot = await service.getSnapshot({ bookId, includeWarnings });
    return c.json({ snapshot });
  });

  app.post("/api/books/:bookId/narrative-line/propose", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const preview = await service.proposeChange({
      bookId,
      summary: typeof body.summary === "string" ? body.summary : "叙事线变更草案",
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : [],
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return c.json({ preview });
  });

  app.post("/api/books/:bookId/narrative-line/apply", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const preview = isRecord(body.preview) ? body.preview : undefined;
    if (!preview || typeof preview.id !== "string" || typeof preview.summary !== "string") {
      return c.json({ error: "INVALID_NARRATIVE_PREVIEW", message: "Narrative line mutation preview is required." }, 400);
    }
    const result = await service.applyChange({
      bookId,
      preview: {
        id: preview.id,
        bookId,
        summary: preview.summary,
        nodes: Array.isArray(preview.nodes) ? preview.nodes as never : [],
        edges: Array.isArray(preview.edges) ? preview.edges as never : [],
        warnings: Array.isArray(preview.warnings) ? preview.warnings as never : [],
      },
      decision: body.decision === "approved" ? "approved" : "rejected",
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      confirmationId: typeof body.confirmationId === "string" ? body.confirmationId : undefined,
    });
    return c.json({ result });
  });

  return app;
}
