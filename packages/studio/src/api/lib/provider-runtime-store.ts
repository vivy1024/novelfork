import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ManagedProvider,
  Model,
  ProviderConfig,
  ProviderType,
  ProviderCompatibility,
  ProviderApiMode,
  ProviderThinkingStrength,
} from "../../shared/provider-catalog.js";
import { resolveRuntimeStoragePath } from "./runtime-storage-paths.js";

export type RuntimeModelSource = "detected" | "builtin-platform" | "manual" | "seed";
export type RuntimeModelTestStatus = "untested" | "success" | "error" | "unsupported";

export interface RuntimeModelRecord extends Omit<Model, "lastTestStatus"> {
  source: RuntimeModelSource;
  enabled: boolean;
  lastTestStatus: RuntimeModelTestStatus;
}

export interface RuntimeProviderRecord extends Omit<ManagedProvider, "models"> {
  type: ProviderType;
  compatibility?: ProviderCompatibility;
  apiMode?: ProviderApiMode;
  thinkingStrength?: ProviderThinkingStrength;
  models: RuntimeModelRecord[];
}

export type RuntimePlatformId = "codex" | "kiro" | "cline";
export type RuntimePlatformAccountAuthMode = "json-account" | "local-auth-json" | "oauth" | "device-code";
export type RuntimePlatformAccountStatus = "active" | "disabled" | "expired" | "error";

export interface RuntimePlatformAccountRecord {
  readonly id: string;
  readonly platformId: RuntimePlatformId;
  readonly displayName: string;
  readonly email?: string;
  readonly accountId?: string;
  readonly authMode: RuntimePlatformAccountAuthMode;
  readonly planType?: string;
  readonly status: RuntimePlatformAccountStatus;
  readonly current: boolean;
  readonly priority: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly quota?: {
    readonly hourlyPercentage?: number;
    readonly hourlyResetAt?: string;
    readonly weeklyPercentage?: number;
    readonly weeklyResetAt?: string;
  };
  readonly tags?: readonly string[];
  readonly credentialSource?: "json" | "local" | "oauth";
  readonly createdAt?: string;
  readonly lastUsedAt?: string;
  readonly credentialJson?: unknown;
}

export interface RuntimeProviderView extends Omit<RuntimeProviderRecord, "config"> {
  config: Omit<ProviderConfig, "apiKey"> & { apiKeyConfigured: boolean };
}

export interface RuntimePlatformAccountView extends Omit<RuntimePlatformAccountRecord, "credentialJson"> {
  credentialConfigured: boolean;
}

export interface ProviderRuntimeState {
  version: 1;
  updatedAt: string;
  providers: RuntimeProviderRecord[];
  platformAccounts: RuntimePlatformAccountRecord[];
}

export type CreateRuntimeProviderInput = Omit<RuntimeProviderRecord, "models"> & {
  readonly models?: readonly (Partial<RuntimeModelRecord> & Pick<RuntimeModelRecord, "id" | "name" | "contextWindow" | "maxOutputTokens">)[];
};

export type RuntimeProviderUpdates = Partial<Omit<RuntimeProviderRecord, "id" | "models" | "config">> & {
  readonly config?: Partial<ProviderConfig>;
  readonly models?: readonly (Partial<RuntimeModelRecord> & Pick<RuntimeModelRecord, "id" | "name" | "contextWindow" | "maxOutputTokens">)[];
};

export type RuntimeModelInput = Partial<RuntimeModelRecord> & Pick<RuntimeModelRecord, "id" | "name" | "contextWindow" | "maxOutputTokens">;
export type RuntimeModelPatch = Partial<Omit<RuntimeModelRecord, "id">>;

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyState(): ProviderRuntimeState {
  return {
    version: 1,
    updatedAt: nowIso(),
    providers: [],
    platformAccounts: [],
  };
}

function normalizeModel(model: RuntimeModelInput): RuntimeModelRecord {
  return {
    ...model,
    enabled: model.enabled ?? true,
    source: model.source ?? "manual",
    lastTestStatus: model.lastTestStatus ?? "untested",
  };
}

function normalizeProvider(provider: CreateRuntimeProviderInput | RuntimeProviderRecord): RuntimeProviderRecord {
  return {
    ...provider,
    enabled: provider.enabled ?? true,
    priority: provider.priority ?? 1,
    config: { ...(provider.config ?? {}) },
    models: (provider.models ?? []).map((model) => normalizeModel(model)),
  };
}

function normalizeState(value: unknown): ProviderRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider runtime state must be an object");
  }

  const candidate = value as Partial<ProviderRuntimeState>;
  return {
    version: 1,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
    providers: Array.isArray(candidate.providers) ? candidate.providers.map((provider) => normalizeProvider(provider)) : [],
    platformAccounts: Array.isArray(candidate.platformAccounts) ? candidate.platformAccounts.map((account) => ({ ...account })) : [],
  };
}

function sortProviders(providers: readonly RuntimeProviderRecord[]): RuntimeProviderRecord[] {
  return clone([...providers].sort((left, right) => left.priority - right.priority));
}

function sortAccounts(accounts: readonly RuntimePlatformAccountRecord[]): RuntimePlatformAccountRecord[] {
  return clone([...accounts].sort((left, right) => left.priority - right.priority));
}

export class ProviderRuntimeStore {
  private readonly storagePath: string;

  constructor(options: { readonly storagePath?: string } = {}) {
    this.storagePath = options.storagePath ?? resolveRuntimeStoragePath("provider-runtime.json");
  }

  async loadState(): Promise<ProviderRuntimeState> {
    try {
      const raw = await readFile(this.storagePath, "utf-8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyState();
      }
      throw error;
    }
  }

  async saveState(state: ProviderRuntimeState): Promise<void> {
    const normalized = normalizeState({
      ...state,
      updatedAt: state.updatedAt || nowIso(),
    });
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  }

  async listProviders(): Promise<RuntimeProviderRecord[]> {
    const state = await this.loadState();
    return sortProviders(state.providers);
  }

  async getProvider(providerId: string): Promise<RuntimeProviderRecord | undefined> {
    const state = await this.loadState();
    const provider = state.providers.find((candidate) => candidate.id === providerId);
    return provider ? clone(provider) : undefined;
  }

  async createProvider(provider: CreateRuntimeProviderInput): Promise<RuntimeProviderRecord> {
    const state = await this.loadState();
    if (state.providers.some((candidate) => candidate.id === provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`);
    }

    const created = normalizeProvider(provider);
    state.providers.push(created);
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(created);
  }

  async updateProvider(providerId: string, updates: RuntimeProviderUpdates): Promise<RuntimeProviderRecord> {
    const state = await this.loadState();
    const index = state.providers.findIndex((candidate) => candidate.id === providerId);
    if (index === -1) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const current = state.providers[index];
    const updated = normalizeProvider({
      ...current,
      ...updates,
      id: current.id,
      config: {
        ...current.config,
        ...(updates.config ?? {}),
      },
      models: updates.models ?? current.models,
    });
    state.providers[index] = updated;
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(updated);
  }

  async deleteProvider(providerId: string): Promise<void> {
    const state = await this.loadState();
    state.providers = state.providers.filter((provider) => provider.id !== providerId);
    state.updatedAt = nowIso();
    await this.saveState(state);
  }

  async upsertModels(providerId: string, models: readonly RuntimeModelInput[]): Promise<RuntimeModelRecord[]> {
    const state = await this.loadState();
    const provider = state.providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const existingById = new Map(provider.models.map((model) => [model.id, model]));
    for (const model of models) {
      existingById.set(model.id, normalizeModel({ ...existingById.get(model.id), ...model }));
    }
    provider.models = Array.from(existingById.values());
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(provider.models);
  }

  async patchModel(providerId: string, modelId: string, updates: RuntimeModelPatch): Promise<RuntimeModelRecord> {
    const state = await this.loadState();
    const provider = state.providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const index = provider.models.findIndex((model) => model.id === modelId);
    if (index === -1) {
      throw new Error(`Model not found: ${providerId}:${modelId}`);
    }

    const current = provider.models[index];
    const updated = normalizeModel({ ...current, ...updates, id: current.id });
    provider.models[index] = updated;
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(updated);
  }

  async getModel(providerId: string, modelId: string): Promise<RuntimeModelRecord | undefined> {
    const provider = await this.getProvider(providerId);
    return provider?.models.find((model) => model.id === modelId);
  }

  async importPlatformAccount(account: RuntimePlatformAccountRecord): Promise<RuntimePlatformAccountRecord> {
    const state = await this.loadState();
    const existingIndex = state.platformAccounts.findIndex((candidate) => candidate.id === account.id);
    const normalized = { ...account };

    if (existingIndex === -1) {
      state.platformAccounts.push(normalized);
    } else {
      state.platformAccounts[existingIndex] = normalized;
    }

    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(normalized);
  }

  async listPlatformAccounts(): Promise<RuntimePlatformAccountRecord[]> {
    const state = await this.loadState();
    return sortAccounts(state.platformAccounts);
  }

  async listProviderViews(): Promise<RuntimeProviderView[]> {
    const providers = await this.listProviders();
    return providers.map((provider) => {
      const { apiKey, ...restConfig } = provider.config;
      return {
        ...provider,
        config: {
          ...restConfig,
          apiKeyConfigured: Boolean(apiKey?.trim()),
        },
      };
    });
  }

  async listPlatformAccountViews(): Promise<RuntimePlatformAccountView[]> {
    const accounts = await this.listPlatformAccounts();
    return accounts.map((account) => {
      const { credentialJson, ...view } = account;
      return {
        ...view,
        credentialConfigured: credentialJson !== undefined,
      };
    });
  }

  async updatePlatformAccount(accountId: string, updates: Partial<Omit<RuntimePlatformAccountRecord, "id" | "credentialJson">>): Promise<RuntimePlatformAccountRecord> {
    const state = await this.loadState();
    const index = state.platformAccounts.findIndex((account) => account.id === accountId);
    if (index === -1) throw new Error(`Platform account not found: ${accountId}`);
    const updated = { ...state.platformAccounts[index], ...updates };
    state.platformAccounts[index] = updated;
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(updated);
  }

  async setCurrentPlatformAccount(platformId: RuntimePlatformId, accountId: string): Promise<RuntimePlatformAccountRecord> {
    const state = await this.loadState();
    const index = state.platformAccounts.findIndex((account) => account.id === accountId && account.platformId === platformId);
    if (index === -1) throw new Error(`Platform account not found: ${accountId}`);
    state.platformAccounts = state.platformAccounts.map((account) => account.platformId === platformId
      ? { ...account, current: account.id === accountId }
      : account);
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(state.platformAccounts[index]);
  }

  async deletePlatformAccount(accountId: string): Promise<void> {
    const state = await this.loadState();
    state.platformAccounts = state.platformAccounts.filter((account) => account.id !== accountId);
    state.updatedAt = nowIso();
    await this.saveState(state);
  }
}
