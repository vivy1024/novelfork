import { Hono } from "hono";
import type { StateManager, StorageDatabase } from "@vivy1024/novelfork-core";

import { createNarrativeLineService } from "../lib/narrative-line-service.js";

export interface CreateNarrativeLineRouterOptions {
  readonly state: StateManager;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
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

  return app;
}
