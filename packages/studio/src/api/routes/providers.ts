import { Hono } from "hono";

import {
  createProviderAdapterRegistry,
  type ProviderAdapterRegistry,
  type RuntimeAdapterId,
} from "../lib/provider-adapters/index.js";
import { buildRuntimeModelPool, buildRuntimeProviderStatus } from "../lib/runtime-model-pool.js";
import { buildProviderFailureEnvelope, getProviderFailureHttpStatus } from "../errors.js";
import {
  ProviderRuntimeStore,
  type CreateRuntimeProviderInput,
  type RuntimeModelInput,
  type RuntimeProviderRecord,
  type RuntimeProviderUpdates,
} from "../lib/provider-runtime-store.js";

export interface ProvidersRouterOptions {
  readonly store?: ProviderRuntimeStore;
  readonly adapters?: ProviderAdapterRegistry;
}

type ProviderBody = Partial<CreateRuntimeProviderInput> & { id?: string; name?: string; type?: CreateRuntimeProviderInput["type"] };

function sanitizeProvider(provider: RuntimeProviderRecord) {
  const { apiKey, ...restConfig } = provider.config ?? {};
  return {
    ...provider,
    config: {
      ...restConfig,
      apiKeyConfigured: Boolean(apiKey?.trim()),
    },
  };
}

function adapterIdForProvider(provider: RuntimeProviderRecord): RuntimeAdapterId {
  if (provider.id === "codex") return "codex-platform";
  if (provider.id === "kiro") return "kiro-platform";
  if (provider.compatibility === "anthropic-compatible") return "anthropic-compatible";
  return "openai-compatible";
}

function providerRef(provider: RuntimeProviderRecord) {
  return {
    providerId: provider.id,
    providerName: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.config?.apiKey ? { apiKey: provider.config.apiKey } : {}),
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message);
}

function withRefreshMetadata(models: readonly RuntimeModelInput[]): RuntimeModelInput[] {
  const lastRefreshedAt = new Date().toISOString();
  return models.map((model) => ({
    ...model,
    lastRefreshedAt,
    source: model.source ?? "detected",
    lastTestStatus: model.lastTestStatus ?? "untested",
  }));
}

function firstEnabledModel(provider: RuntimeProviderRecord) {
  return provider.models.find((model) => model.enabled !== false);
}

function modelCapabilities(model: RuntimeProviderRecord["models"][number]): string[] {
  const capabilities: string[] = [];
  if (model.contextWindow >= 128000) capabilities.push("大上下文");
  if (model.supportsVision === true) capabilities.push("多模态");
  if ((model as { supportsReasoning?: boolean }).supportsReasoning === true) capabilities.push("思考链");
  if (model.supportsFunctionCalling === true) capabilities.push("工具调用");
  return capabilities.length > 0 ? capabilities : ["unknown"];
}

async function buildProviderSummary(store: ProviderRuntimeStore) {
  const [providers, platformAccounts, runtimeModels] = await Promise.all([store.listProviders(), store.listPlatformAccounts(), buildRuntimeModelPool(store)]);
  const physicalModelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const totalCatalogModelCount = physicalModelCount;
  const availableModelCount = runtimeModels.length;
  const callableModelCount = runtimeModels.filter((model) => model.lastTestStatus === "success").length;
  const issueCount = providers.filter((provider) => !provider.enabled || provider.models.some((model) => model.lastTestStatus === "error")).length
    + platformAccounts.filter((account) => account.status !== "active").length;
  return {
    providerCount: providers.length,
    enabledProviderCount: providers.filter((provider) => provider.enabled).length,
    physicalModelCount,
    availableModelCount,
    totalCatalogModelCount,
    callableModelCount,
    platformAccountCount: platformAccounts.length,
    enabledPlatformAccountCount: platformAccounts.filter((account) => account.status === "active").length,
    issueCount,
  };
}

async function buildGroupedModels(store: ProviderRuntimeStore) {
  const providers = await store.listProviders();
  return providers.map((provider) => ({
    providerId: provider.id,
    providerName: provider.name,
    enabled: provider.enabled,
    health: provider.enabled ? "可用" : "已停用",
    models: provider.models.map((model) => ({
      ...model,
      capabilities: modelCapabilities(model),
    })),
  }));
}

export function createProvidersRouter(options: ProvidersRouterOptions = {}) {
  const app = new Hono();
  const store = options.store ?? new ProviderRuntimeStore();
  const adapters = options.adapters ?? createProviderAdapterRegistry();

  app.get("/", async (c) => {
    try {
      const providers = (await store.listProviders()).map(sanitizeProvider);
      return c.json({ providers });
    } catch (error) {
      console.error("Failed to list providers:", error);
      return c.json({ error: "Failed to list providers" }, 500);
    }
  });

  app.get("/status", async (c) => {
    try {
      return c.json({ status: await buildRuntimeProviderStatus(store) });
    } catch (error) {
      console.error("Failed to get provider status:", error);
      return c.json({ error: "Failed to get provider status" }, 500);
    }
  });

  app.get("/summary", async (c) => {
    try {
      return c.json({ summary: await buildProviderSummary(store) });
    } catch (error) {
      console.error("Failed to get provider summary:", error);
      return c.json({ error: "Failed to get provider summary" }, 500);
    }
  });

  app.get("/models/grouped", async (c) => {
    try {
      return c.json({ groups: await buildGroupedModels(store) });
    } catch (error) {
      console.error("Failed to get grouped models:", error);
      return c.json({ error: "Failed to get grouped models" }, 500);
    }
  });

  app.get("/models", async (c) => {
    try {
      return c.json({ models: await buildRuntimeModelPool(store) });
    } catch (error) {
      console.error("Failed to get model pool:", error);
      return c.json({ error: "Failed to get model pool" }, 500);
    }
  });

  app.post("/reorder", async (c) => {
    try {
      const { orderedIds } = await c.req.json<{ orderedIds?: string[] }>();
      if (!Array.isArray(orderedIds)) return c.json({ error: "orderedIds must be an array" }, 400);
      const existing = await store.listProviders();
      if (orderedIds.some((id) => !existing.some((provider) => provider.id === id))) {
        return c.json({ error: "Invalid provider IDs" }, 400);
      }
      for (const [index, id] of orderedIds.entries()) {
        await store.updateProvider(id, { priority: index + 1 });
      }
      return c.json({ providers: (await store.listProviders()).map(sanitizeProvider) });
    } catch (error) {
      console.error("Failed to reorder providers:", error);
      return c.json({ error: "Failed to reorder providers" }, 500);
    }
  });

  app.post("/", async (c) => {
    try {
      const body = await c.req.json<ProviderBody>();
      if (!body.id || !body.name || !body.type) {
        return c.json({ error: "Missing required fields: id, name, type" }, 400);
      }
      const provider = await store.createProvider({
        ...body,
        id: body.id,
        name: body.name,
        type: body.type,
        enabled: body.enabled ?? true,
        priority: body.priority ?? (await store.listProviders()).length + 1,
        apiKeyRequired: body.apiKeyRequired ?? false,
        config: body.config ?? {},
        models: body.models ?? [],
      });
      return c.json({ provider: sanitizeProvider(provider) }, 201);
    } catch (error) {
      console.error("Failed to add provider:", error);
      return c.json({ error: "Failed to add provider" }, 500);
    }
  });

  app.post("/:id/models/refresh", async (c) => {
    try {
      const id = c.req.param("id");
      const provider = await store.getProvider(id);
      if (!provider) return c.json({ error: "Provider not found" }, 404);
      const result = await adapters.get(adapterIdForProvider(provider)).listModels(providerRef(provider));
      if (!result.success) return c.json(buildProviderFailureEnvelope(result), getProviderFailureHttpStatus(result));
      const models = await store.upsertModels(id, withRefreshMetadata(result.models));
      const updated = await store.getProvider(id);
      return c.json({ provider: updated ? sanitizeProvider(updated) : undefined, models });
    } catch (error) {
      console.error("Failed to refresh provider models:", error);
      return c.json({ error: "Failed to refresh provider models" }, 500);
    }
  });

  app.patch("/:id/models/:modelId", async (c) => {
    try {
      const model = await store.patchModel(c.req.param("id"), c.req.param("modelId"), await c.req.json());
      return c.json({ model });
    } catch (error) {
      if (isNotFound(error)) return c.json({ error: "Model not found" }, 404);
      console.error("Failed to update provider model:", error);
      return c.json({ error: "Failed to update provider model" }, 500);
    }
  });

  app.post("/:id/models/:modelId/test", async (c) => {
    try {
      const id = c.req.param("id");
      const modelId = c.req.param("modelId");
      const provider = await store.getProvider(id);
      if (!provider) return c.json({ error: "Provider not found" }, 404);
      const model = provider.models.find((candidate) => candidate.id === modelId);
      if (!model) return c.json({ error: "Model not found" }, 404);
      const result = await adapters.get(adapterIdForProvider(provider)).testModel({ ...providerRef(provider), modelId });
      const patched = await store.patchModel(id, modelId, result.success
        ? { lastTestStatus: "success", lastTestLatency: result.latency, lastTestError: undefined }
        : { lastTestStatus: result.code === "unsupported" ? "unsupported" : "error", lastTestError: result.error });
      if (!result.success) return c.json({ ...buildProviderFailureEnvelope(result), model: patched }, getProviderFailureHttpStatus(result));
      return c.json({ success: true, latency: result.latency, model: patched });
    } catch (error) {
      console.error("Failed to test provider model:", error);
      return c.json({ error: "Failed to test provider model" }, 500);
    }
  });

  app.get("/:id", async (c) => {
    try {
      const provider = await store.getProvider(c.req.param("id"));
      if (!provider) return c.json({ error: "Provider not found" }, 404);
      return c.json({ provider: sanitizeProvider(provider) });
    } catch (error) {
      console.error("Failed to get provider:", error);
      return c.json({ error: "Failed to get provider" }, 500);
    }
  });

  app.put("/:id", async (c) => {
    try {
      const provider = await store.updateProvider(c.req.param("id"), await c.req.json<RuntimeProviderUpdates>());
      return c.json({ provider: sanitizeProvider(provider) });
    } catch (error) {
      if (isNotFound(error)) return c.json({ error: "Provider not found" }, 404);
      console.error("Failed to update provider:", error);
      return c.json({ error: "Failed to update provider" }, 500);
    }
  });

  app.patch("/:id/advanced", async (c) => {
    try {
      const provider = await store.updateProvider(c.req.param("id"), await c.req.json<RuntimeProviderUpdates>());
      return c.json({ provider: sanitizeProvider(provider) });
    } catch (error) {
      if (isNotFound(error)) return c.json({ error: "Provider not found" }, 404);
      console.error("Failed to update provider advanced settings:", error);
      return c.json({ error: "Failed to update provider advanced settings" }, 500);
    }
  });

  app.post("/:id/health-check", async (c) => {
    try {
      const provider = await store.getProvider(c.req.param("id"));
      if (!provider) return c.json({ error: "Provider not found" }, 404);
      const model = firstEnabledModel(provider);
      if (!model) return c.json({ health: { status: "error", message: "没有启用模型" } }, 400);
      const result = await adapters.get(adapterIdForProvider(provider)).testModel({ ...providerRef(provider), modelId: model.id });
      return c.json(result.success
        ? { health: { status: "success", latency: result.latency, checkedAt: new Date().toISOString() } }
        : { health: { status: "error", message: result.error, checkedAt: new Date().toISOString() } });
    } catch (error) {
      console.error("Failed to check provider health:", error);
      return c.json({ error: "Failed to check provider health" }, 500);
    }
  });

  app.post("/:id/toggle", async (c) => {
    try {
      const { enabled } = await c.req.json<{ enabled: boolean }>();
      const provider = await store.updateProvider(c.req.param("id"), { enabled });
      return c.json({ provider: sanitizeProvider(provider) });
    } catch (error) {
      if (isNotFound(error)) return c.json({ error: "Provider not found" }, 404);
      console.error("Failed to toggle provider:", error);
      return c.json({ error: "Failed to toggle provider" }, 500);
    }
  });

  app.post("/:id/test", async (c) => {
    try {
      const provider = await store.getProvider(c.req.param("id"));
      if (!provider) return c.json({ error: "Provider not found" }, 404);
      const model = firstEnabledModel(provider);
      if (!model) return c.json({ success: false, error: "No enabled model" }, 400);
      const result = await adapters.get(adapterIdForProvider(provider)).testModel({ ...providerRef(provider), modelId: model.id });
      await store.patchModel(provider.id, model.id, result.success
        ? { lastTestStatus: "success", lastTestLatency: result.latency, lastTestError: undefined }
        : { lastTestStatus: result.code === "unsupported" ? "unsupported" : "error", lastTestError: result.error });
      if (!result.success) return c.json(buildProviderFailureEnvelope(result), getProviderFailureHttpStatus(result));
      return c.json({ success: true, latency: result.latency });
    } catch (error) {
      console.error("Failed to test provider:", error);
      return c.json({ error: "Failed to test provider" }, 500);
    }
  });

  app.delete("/:id", async (c) => {
    try {
      await store.deleteProvider(c.req.param("id"));
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to delete provider:", error);
      return c.json({ error: "Failed to delete provider" }, 500);
    }
  });

  return app;
}
