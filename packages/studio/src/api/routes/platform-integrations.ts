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
    description: "导入 Codex / ChatGPT JSON 账号数据后作为平台账号使用，后续支持配额刷新与自动故障转移。",
    enabled: true,
    supportedImportMethods: ["json-account", "local-auth-json", "oauth", "device-code"],
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
  {
    id: "cline",
    name: "Cline",
    description: "管理 Cline 平台账号与凭据。JSON 导入后续接入。",
    enabled: false,
    supportedImportMethods: [],
    modelCount: 0,
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

  return app;
}
