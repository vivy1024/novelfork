import { Hono } from "hono";

import { ProviderRuntimeStore, type CreateRuntimeVirtualModelInput, type RuntimeVirtualModelUpdates } from "../lib/provider-runtime-store.js";

export interface VirtualModelsRouterOptions {
  readonly store?: ProviderRuntimeStore;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /not found|no available/i.test(error.message);
}

export function createVirtualModelsRouter(options: VirtualModelsRouterOptions = {}) {
  const app = new Hono();
  const store = options.store ?? new ProviderRuntimeStore();

  app.get("/", async (c) => c.json({ virtualModels: await store.listVirtualModels() }));

  app.post("/", async (c) => {
    try {
      const virtualModel = await store.createVirtualModel(await c.req.json<CreateRuntimeVirtualModelInput>());
      return c.json({ virtualModel }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/:id", async (c) => {
    const virtualModel = await store.getVirtualModel(c.req.param("id"));
    if (!virtualModel) return c.json({ error: "Virtual model not found" }, 404);
    return c.json({ virtualModel });
  });

  app.put("/:id", async (c) => {
    try {
      const virtualModel = await store.updateVirtualModel(c.req.param("id"), await c.req.json<RuntimeVirtualModelUpdates>());
      return c.json({ virtualModel });
    } catch (error) {
      if (isNotFound(error)) return c.json({ error: "Virtual model not found" }, 404);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/:id", async (c) => {
    await store.deleteVirtualModel(c.req.param("id"));
    return c.json({ success: true });
  });

  app.post("/:id/test-route", async (c) => {
    try {
      const route = await store.resolveVirtualModelRoute(c.req.param("id"));
      return c.json({ route });
    } catch (error) {
      if (isNotFound(error)) return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return app;
}
