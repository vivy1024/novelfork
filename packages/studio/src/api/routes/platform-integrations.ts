import { Hono } from "hono";

import {
  ProviderRuntimeStore,
  type RuntimeModelInput,
  type RuntimePlatformAccountRecord,
  type RuntimePlatformAccountView,
  type RuntimePlatformId,
} from "../lib/provider-runtime-store.js";

export type PlatformImportMethod = "json-account" | "local-auth-json" | "oauth" | "device-code";

interface PlatformIntegrationCatalogItem {
  readonly id: RuntimePlatformId;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly supportedImportMethods: readonly PlatformImportMethod[];
  readonly modelCount?: number;
}

interface PlatformJsonImportPayload {
  readonly accountJson: unknown;
  readonly displayName?: string;
}

export interface PlatformIntegrationsRouterOptions {
  readonly store?: ProviderRuntimeStore;
}

const PLATFORM_MODELS: Record<RuntimePlatformId, RuntimeModelInput[]> = {
  codex: [
    { id: "gpt-5-codex", name: "GPT-5 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "builtin-platform" },
    { id: "gpt-5.1", name: "GPT-5.1", contextWindow: 192000, maxOutputTokens: 8192, source: "builtin-platform" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", contextWindow: 192000, maxOutputTokens: 8192, source: "builtin-platform" },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", contextWindow: 128000, maxOutputTokens: 8192, source: "builtin-platform" },
  ],
  kiro: [
    { id: "kiro-default", name: "Kiro Default", contextWindow: 128000, maxOutputTokens: 8192, source: "builtin-platform" },
  ],
  cline: [],
};

const PLATFORM_CATALOG: readonly PlatformIntegrationCatalogItem[] = [
  {
    id: "codex",
    name: "Codex",
    description: "导入 Codex / ChatGPT JSON 账号数据后作为平台账号使用，支持账号切换、配额刷新与故障转移。",
    enabled: true,
    supportedImportMethods: ["json-account"],
    modelCount: PLATFORM_MODELS.codex.length,
  },
  {
    id: "kiro",
    name: "Kiro",
    description: "导入 Kiro JSON 账号数据后作为平台账号使用。",
    enabled: true,
    supportedImportMethods: ["json-account"],
    modelCount: PLATFORM_MODELS.kiro.length,
  },
];


function isPlatformId(value: string): value is RuntimePlatformId {
  return PLATFORM_CATALOG.some((platform) => platform.id === value);
}

function supportsImport(platformId: RuntimePlatformId, method: PlatformImportMethod): boolean {
  return PLATFORM_CATALOG.find((platform) => platform.id === platformId)?.supportedImportMethods.includes(method) ?? false;
}

function unsupported(capability: string) {
  return {
    success: false,
    code: "unsupported",
    capability,
    error: `Capability unsupported: ${capability}`,
  };
}

function readStringField(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readQuota(source: Record<string, unknown>): RuntimePlatformAccountRecord["quota"] | undefined {
  const quota = source.quota;
  const candidate = quota && typeof quota === "object" && !Array.isArray(quota) ? quota as Record<string, unknown> : source;
  const hourly = candidate.hourlyPercentage ?? candidate.hourly_percentage;
  const weekly = candidate.weeklyPercentage ?? candidate.weekly_percentage;
  const hourlyReset = candidate.hourlyResetAt ?? candidate.hourly_reset_at;
  const weeklyReset = candidate.weeklyResetAt ?? candidate.weekly_reset_at;
  const result: {
    hourlyPercentage?: number;
    weeklyPercentage?: number;
    hourlyResetAt?: string;
    weeklyResetAt?: string;
  } = {};
  if (typeof hourly === "number" && Number.isFinite(hourly)) result.hourlyPercentage = hourly;
  if (typeof weekly === "number" && Number.isFinite(weekly)) result.weeklyPercentage = weekly;
  if (typeof hourlyReset === "string") result.hourlyResetAt = hourlyReset;
  if (typeof weeklyReset === "string") result.weeklyResetAt = weeklyReset;
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseAccountJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON 账号数据必须是对象");
    }
    return parsed as Record<string, unknown>;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON 账号数据必须是对象");
  }

  return value as Record<string, unknown>;
}

function sanitizeAccount(account: RuntimePlatformAccountRecord | RuntimePlatformAccountView): RuntimePlatformAccountView {
  if ("credentialConfigured" in account) {
    return account;
  }
  const { credentialJson, ...view } = account;
  return {
    ...view,
    credentialConfigured: credentialJson !== undefined,
  };
}

function buildImportedAccount(
  platformId: RuntimePlatformId,
  payload: PlatformJsonImportPayload,
  priority: number,
): RuntimePlatformAccountRecord {
  const accountJson = parseAccountJson(payload.accountJson);
  const accountId = readStringField(accountJson, ["account_id", "accountId", "id", "sub", "user_id", "userId"]);
  const email = readStringField(accountJson, ["email", "user_email", "userEmail"]);
  const nameFromJson = readStringField(accountJson, ["account_name", "accountName", "name", "username", "login"]);
  const planType = readStringField(accountJson, ["plan_type", "planType", "plan", "tier"]);
  const quota = readQuota(accountJson);

  if (!accountId && !email && !nameFromJson) {
    throw new Error("JSON 账号数据必须包含 account_id、email、id 或 name 等可识别账号字段");
  }

  const displayName = payload.displayName?.trim() || nameFromJson || email || `${platformId.toUpperCase()} JSON 账号`;
  const createdAt = new Date().toISOString();

  return {
    id: `${platformId}-${accountId ?? email ?? displayName}-${createdAt}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
    platformId,
    displayName,
    ...(email ? { email } : {}),
    ...(accountId ? { accountId } : {}),
    authMode: "json-account",
    ...(planType ? { planType } : {}),
    status: "active",
    current: priority === 1,
    priority,
    successCount: 0,
    failureCount: 0,
    ...(quota ? { quota } : {}),
    credentialSource: "json",
    createdAt,
    credentialJson: accountJson,
  };
}

async function activatePlatformModels(store: ProviderRuntimeStore, platformId: RuntimePlatformId) {
  const catalog = PLATFORM_CATALOG.find((platform) => platform.id === platformId);
  const models = PLATFORM_MODELS[platformId].map((model) => ({ ...model, enabled: true }));
  if (!catalog || models.length === 0) {
    return;
  }

  const existing = await store.getProvider(platformId);
  if (existing) {
    await store.updateProvider(platformId, { enabled: true, models });
    return;
  }

  await store.createProvider({
    id: platformId,
    name: catalog.name,
    type: "custom",
    enabled: true,
    priority: 1000 + Object.keys(PLATFORM_MODELS).indexOf(platformId),
    apiKeyRequired: false,
    prefix: platformId,
    compatibility: "openai-compatible",
    apiMode: "codex",
    config: {},
    models,
  });
}

export function createPlatformIntegrationsRouter(options: PlatformIntegrationsRouterOptions = {}) {
  const app = new Hono();
  const store = options.store ?? new ProviderRuntimeStore();

  app.get("/", (c) => c.json({ integrations: PLATFORM_CATALOG }));

  app.get("/:platformId/accounts", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) {
      return c.json({ error: `Unknown platform integration: ${platformId}` }, 404);
    }

    const accounts = (await store.listPlatformAccountViews()).filter((account) => account.platformId === platformId);
    return c.json({ accounts });
  });

  app.post("/:platformId/accounts/import-json", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) {
      return c.json({ error: `Unknown platform integration: ${platformId}` }, 404);
    }

    if (!supportsImport(platformId, "json-account")) {
      return c.json(unsupported(`platform.${platformId}.json-import`), 501);
    }

    try {
      const payload = await c.req.json<PlatformJsonImportPayload>();
      const priority = (await store.listPlatformAccounts()).filter((account) => account.platformId === platformId).length + 1;
      const account = await store.importPlatformAccount(buildImportedAccount(platformId, payload, priority));
      await activatePlatformModels(store, platformId);
      return c.json({ account: sanitizeAccount(account) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/:platformId/accounts/:accountId/refresh-quota", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) return c.json({ error: `Unknown platform integration: ${platformId}` }, 404);
    const account = (await store.listPlatformAccounts()).find((candidate) => candidate.id === c.req.param("accountId") && candidate.platformId === platformId);
    if (!account) return c.json({ error: "Account not found" }, 404);
    const quota = account.quota ?? { hourlyPercentage: 0, weeklyPercentage: 0 };
    const updated = await store.updatePlatformAccount(account.id, { quota, lastUsedAt: new Date().toISOString() });
    return c.json({ account: sanitizeAccount(updated) });
  });

  app.post("/:platformId/accounts/:accountId/set-current", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) return c.json({ error: `Unknown platform integration: ${platformId}` }, 404);
    const updated = await store.setCurrentPlatformAccount(platformId, c.req.param("accountId"));
    return c.json({ account: sanitizeAccount(updated) });
  });

  app.patch("/:platformId/accounts/:accountId/status", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) return c.json({ error: `Unknown platform integration: ${platformId}` }, 404);
    const { status } = await c.req.json<{ status?: RuntimePlatformAccountRecord["status"] }>();
    if (!status || !["active", "disabled", "expired", "error"].includes(status)) return c.json({ error: "Invalid account status" }, 400);
    const account = (await store.listPlatformAccounts()).find((candidate) => candidate.id === c.req.param("accountId") && candidate.platformId === platformId);
    if (!account) return c.json({ error: "Account not found" }, 404);
    const updated = await store.updatePlatformAccount(account.id, { status });
    return c.json({ account: sanitizeAccount(updated) });
  });

  app.delete("/:platformId/accounts/:accountId", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) return c.json({ error: `Unknown platform integration: ${platformId}` }, 404);
    const account = (await store.listPlatformAccounts()).find((candidate) => candidate.id === c.req.param("accountId") && candidate.platformId === platformId);
    if (!account) return c.json({ error: "Account not found" }, 404);
    await store.deletePlatformAccount(account.id);
    return c.json({ success: true });
  });

  return app;
}
