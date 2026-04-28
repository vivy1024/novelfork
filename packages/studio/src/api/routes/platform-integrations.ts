import { Hono } from "hono";
import type {
  PlatformAccount,
  PlatformId,
  PlatformImportMethod,
  PlatformIntegrationCatalogItem,
  PlatformJsonImportPayload,
} from "../../app-next/settings/provider-types.js";

const PLATFORM_CATALOG: readonly PlatformIntegrationCatalogItem[] = [
  {
    id: "codex",
    name: "Codex",
    description: "导入 Codex / ChatGPT JSON 账号数据后作为平台账号使用，后续支持配额刷新与自动故障转移。",
    enabled: true,
    supportedImportMethods: ["json-account", "local-auth-json", "oauth", "device-code"],
    modelCount: 4,
  },
  {
    id: "kiro",
    name: "Kiro",
    description: "导入 Kiro JSON 账号数据后作为平台账号使用。",
    enabled: true,
    supportedImportMethods: ["json-account"],
    modelCount: 0,
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

function isPlatformId(value: string): value is PlatformId {
  return PLATFORM_CATALOG.some((platform) => platform.id === value);
}

function platformNotFound(platformId: string) {
  return { error: `Unknown platform integration: ${platformId}` };
}

function supportsImport(platformId: PlatformId, method: PlatformImportMethod): boolean {
  return PLATFORM_CATALOG.find((platform) => platform.id === platformId)?.supportedImportMethods.includes(method) ?? false;
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

function buildImportedAccount(platformId: PlatformId, payload: PlatformJsonImportPayload, priority: number): PlatformAccount {
  const accountJson = parseAccountJson(payload.accountJson);
  const accountId = readStringField(accountJson, ["account_id", "accountId", "id", "sub", "user_id", "userId"]);
  const email = readStringField(accountJson, ["email", "user_email", "userEmail"]);
  const nameFromJson = readStringField(accountJson, ["account_name", "accountName", "name", "username", "login"]);
  const planType = readStringField(accountJson, ["plan_type", "planType", "plan", "tier"]);
  const displayName = payload.displayName?.trim() || nameFromJson || email || `${platformId.toUpperCase()} JSON 账号`;
  const createdAt = new Date().toISOString();

  return {
    id: `${platformId}-${accountId ?? displayName}-${createdAt}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
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
  };
}

export function createPlatformIntegrationsRouter() {
  const app = new Hono();
  const accountsByPlatform: Record<PlatformId, PlatformAccount[]> = {
    codex: [],
    kiro: [],
    cline: [],
  };

  app.get("/", (c) => {
    return c.json({ integrations: PLATFORM_CATALOG });
  });

  app.get("/:platformId/accounts", (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) {
      return c.json(platformNotFound(platformId), 404);
    }

    return c.json({ accounts: accountsByPlatform[platformId] });
  });

  app.post("/:platformId/accounts/import-json", async (c) => {
    const platformId = c.req.param("platformId");
    if (!isPlatformId(platformId)) {
      return c.json(platformNotFound(platformId), 404);
    }

    if (!supportsImport(platformId, "json-account")) {
      return c.json({ error: `${platformId} does not support JSON account import yet` }, 400);
    }

    try {
      const payload = await c.req.json<PlatformJsonImportPayload>();
      const account = buildImportedAccount(platformId, payload, accountsByPlatform[platformId].length + 1);
      accountsByPlatform[platformId] = [account, ...accountsByPlatform[platformId]];
      return c.json({ account }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return app;
}
