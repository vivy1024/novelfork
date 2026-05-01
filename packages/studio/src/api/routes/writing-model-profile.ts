import { Hono } from "hono";

import { ProviderRuntimeStore, type RuntimeWritingModelProfileInput } from "../lib/provider-runtime-store.js";

export interface WritingModelProfileRouterOptions {
  readonly store?: ProviderRuntimeStore;
}

export function createWritingModelProfileRouter(options: WritingModelProfileRouterOptions = {}) {
  const app = new Hono();
  const store = options.store ?? new ProviderRuntimeStore();

  app.get("/", async (c) => c.json({ profile: await store.getWritingModelProfile() }));

  app.put("/", async (c) => {
    const profile = await store.updateWritingModelProfile(await c.req.json<RuntimeWritingModelProfileInput>());
    return c.json({ profile });
  });

  app.post("/validate", async (c) => c.json({ profile: await store.getWritingModelProfile() }));

  return app;
}
