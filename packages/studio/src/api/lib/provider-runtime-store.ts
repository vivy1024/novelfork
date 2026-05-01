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

export type RuntimeModelCapability = "tools" | "vision" | "streaming" | "large-context" | "long-output" | "low-cost" | "draft" | "audit" | "summary";
export type VirtualModelRoutingMode = "manual" | "priority" | "fallback" | "quota-aware";

export interface RuntimeVirtualModelMember {
  readonly providerId: string;
  readonly modelId: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly note?: string;
}

export interface RuntimeVirtualModelRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly routingMode: VirtualModelRoutingMode;
  readonly members: readonly RuntimeVirtualModelMember[];
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WritingTaskKind = "outline" | "draft" | "continue" | "revision" | "continuity-audit" | "character-audit" | "worldbuilding-analysis" | "style-imitation" | "de-ai" | "summary" | "title-blurb";
export type ModelReferenceValidationStatus = "empty" | "valid" | "invalid";

export interface RuntimeWritingModelProfileValidation {
  readonly defaultDraftModel: ModelReferenceValidationStatus;
  readonly defaultAnalysisModel: ModelReferenceValidationStatus;
  readonly taskModels: Readonly<Record<string, ModelReferenceValidationStatus>>;
  readonly invalidModelIds: readonly string[];
}

export interface RuntimeWritingModelProfile {
  readonly defaultDraftModel: string;
  readonly defaultAnalysisModel: string;
  readonly taskModels: Partial<Record<WritingTaskKind, string>>;
  readonly advancedAgentModels: {
    readonly explore?: string;
    readonly plan?: string;
    readonly generalPool: readonly string[];
  };
  readonly validation: RuntimeWritingModelProfileValidation;
}

export interface ResolvedRuntimeModelRoute {
  readonly virtualModelId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly routingMode: VirtualModelRoutingMode;
  readonly reason: string;
}

export interface ProviderRuntimeState {
  version: 1;
  updatedAt: string;
  providers: RuntimeProviderRecord[];
  platformAccounts: RuntimePlatformAccountRecord[];
  virtualModels: RuntimeVirtualModelRecord[];
  writingModelProfile: RuntimeWritingModelProfile;
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
export type CreateRuntimeVirtualModelInput = Omit<RuntimeVirtualModelRecord, "createdAt" | "updatedAt"> & Partial<Pick<RuntimeVirtualModelRecord, "createdAt" | "updatedAt">>;
export type RuntimeVirtualModelUpdates = Partial<Omit<RuntimeVirtualModelRecord, "id" | "createdAt" | "updatedAt">>;
export type RuntimeWritingModelProfileInput = Omit<RuntimeWritingModelProfile, "validation"> & { readonly validation?: RuntimeWritingModelProfileValidation };

function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createDefaultWritingModelProfile(virtualModelIds: readonly string[] = []): RuntimeWritingModelProfile {
  return normalizeWritingModelProfile({
    defaultDraftModel: "",
    defaultAnalysisModel: "",
    taskModels: {},
    advancedAgentModels: { generalPool: [] },
  }, virtualModelIds);
}

function createEmptyState(): ProviderRuntimeState {
  return {
    version: 1,
    updatedAt: nowIso(),
    providers: [],
    platformAccounts: [],
    virtualModels: [],
    writingModelProfile: createDefaultWritingModelProfile(),
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

function normalizeVirtualModel(model: CreateRuntimeVirtualModelInput | RuntimeVirtualModelRecord): RuntimeVirtualModelRecord {
  const timestamp = nowIso();
  return {
    ...model,
    enabled: model.enabled ?? true,
    routingMode: model.routingMode ?? "priority",
    members: (model.members ?? []).map((member) => ({ ...member, enabled: member.enabled ?? true, priority: member.priority ?? 1 })),
    tags: [...(model.tags ?? [])],
    createdAt: model.createdAt ?? timestamp,
    updatedAt: model.updatedAt ?? timestamp,
  };
}

function validateModelReference(value: string | undefined, virtualModelIds: ReadonlySet<string>): ModelReferenceValidationStatus {
  if (!value) return "empty";
  return virtualModelIds.has(value) ? "valid" : "invalid";
}

function normalizeWritingModelProfile(value: Partial<RuntimeWritingModelProfileInput> | undefined, virtualModelIds: readonly string[]): RuntimeWritingModelProfile {
  const idSet = new Set(virtualModelIds);
  const taskModels = { ...(value?.taskModels ?? {}) } as Partial<Record<WritingTaskKind, string>>;
  const invalid = new Set<string>();
  const taskValidation: Record<string, ModelReferenceValidationStatus> = {};
  const defaultDraftModel = value?.defaultDraftModel ?? "";
  const defaultAnalysisModel = value?.defaultAnalysisModel ?? "";

  for (const id of [defaultDraftModel, defaultAnalysisModel]) {
    if (id && !idSet.has(id)) invalid.add(id);
  }
  for (const [task, id] of Object.entries(taskModels)) {
    const status = validateModelReference(id, idSet);
    taskValidation[task] = status;
    if (id && status === "invalid") invalid.add(id);
  }

  return {
    defaultDraftModel,
    defaultAnalysisModel,
    taskModels,
    advancedAgentModels: {
      ...(value?.advancedAgentModels?.explore ? { explore: value.advancedAgentModels.explore } : {}),
      ...(value?.advancedAgentModels?.plan ? { plan: value.advancedAgentModels.plan } : {}),
      generalPool: [...(value?.advancedAgentModels?.generalPool ?? [])],
    },
    validation: {
      defaultDraftModel: validateModelReference(defaultDraftModel, idSet),
      defaultAnalysisModel: validateModelReference(defaultAnalysisModel, idSet),
      taskModels: taskValidation,
      invalidModelIds: [...invalid],
    },
  };
}

function normalizeState(value: unknown): ProviderRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider runtime state must be an object");
  }

  const candidate = value as Partial<ProviderRuntimeState>;
  const virtualModels = Array.isArray(candidate.virtualModels) ? candidate.virtualModels.map((model) => normalizeVirtualModel(model)) : [];
  return {
    version: 1,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
    providers: Array.isArray(candidate.providers) ? candidate.providers.map((provider) => normalizeProvider(provider)) : [],
    platformAccounts: Array.isArray(candidate.platformAccounts) ? candidate.platformAccounts.map((account) => ({ ...account })) : [],
    virtualModels,
    writingModelProfile: normalizeWritingModelProfile(candidate.writingModelProfile, virtualModels.map((model) => model.id)),
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

  async listVirtualModels(): Promise<RuntimeVirtualModelRecord[]> {
    const state = await this.loadState();
    return clone(state.virtualModels);
  }

  async getVirtualModel(id: string): Promise<RuntimeVirtualModelRecord | undefined> {
    const state = await this.loadState();
    const model = state.virtualModels.find((candidate) => candidate.id === id);
    return model ? clone(model) : undefined;
  }

  async createVirtualModel(model: CreateRuntimeVirtualModelInput): Promise<RuntimeVirtualModelRecord> {
    const state = await this.loadState();
    if (state.virtualModels.some((candidate) => candidate.id === model.id)) {
      throw new Error(`Virtual model already exists: ${model.id}`);
    }
    const created = normalizeVirtualModel(model);
    state.virtualModels.push(created);
    state.writingModelProfile = normalizeWritingModelProfile(state.writingModelProfile, state.virtualModels.map((candidate) => candidate.id));
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(created);
  }

  async updateVirtualModel(id: string, updates: RuntimeVirtualModelUpdates): Promise<RuntimeVirtualModelRecord> {
    const state = await this.loadState();
    const index = state.virtualModels.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new Error(`Virtual model not found: ${id}`);
    const updated = normalizeVirtualModel({ ...state.virtualModels[index], ...updates, id, updatedAt: nowIso() });
    state.virtualModels[index] = updated;
    state.writingModelProfile = normalizeWritingModelProfile(state.writingModelProfile, state.virtualModels.map((candidate) => candidate.id));
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(updated);
  }

  async deleteVirtualModel(id: string): Promise<void> {
    const state = await this.loadState();
    state.virtualModels = state.virtualModels.filter((model) => model.id !== id);
    state.writingModelProfile = normalizeWritingModelProfile(state.writingModelProfile, state.virtualModels.map((model) => model.id));
    state.updatedAt = nowIso();
    await this.saveState(state);
  }

  async resolveVirtualModelRoute(id: string): Promise<ResolvedRuntimeModelRoute> {
    const state = await this.loadState();
    const virtualModel = state.virtualModels.find((candidate) => candidate.id === id && candidate.enabled !== false);
    if (!virtualModel) throw new Error(`Virtual model not found: ${id}`);
    const providers = new Map(state.providers.map((provider) => [provider.id, provider]));
    const currentAccounts = state.platformAccounts.filter((account) => account.current !== false && account.status === "active");
    const accountByPlatform = new Map(currentAccounts.map((account) => [account.platformId, account]));
    const candidates = virtualModel.members
      .filter((member) => member.enabled !== false)
      .map((member) => {
        const provider = providers.get(member.providerId);
        const model = provider?.models.find((candidate) => candidate.id === member.modelId);
        const account = accountByPlatform.get(member.providerId as RuntimePlatformId);
        const quota = Math.max(account?.quota?.hourlyPercentage ?? -1, account?.quota?.weeklyPercentage ?? -1);
        return { member, provider, model, account, quota };
      })
      .filter((candidate) => candidate.provider?.enabled !== false && candidate.model?.enabled !== false && candidate.provider && candidate.model);

    if (candidates.length === 0) throw new Error(`Virtual model has no available candidates: ${id}`);
    const sorted = [...candidates].sort((left, right) => {
      if (virtualModel.routingMode === "quota-aware") {
        const leftScore = left.quota < 0 ? 0 : left.quota;
        const rightScore = right.quota < 0 ? 0 : right.quota;
        if (leftScore !== rightScore) return leftScore - rightScore;
      }
      return left.member.priority - right.member.priority;
    });
    const selected = sorted[0];
    const reason = virtualModel.routingMode === "quota-aware" && selected.quota < 0
      ? `按优先级选择；${selected.provider!.name} 未记录配额`
      : `按${virtualModel.routingMode}策略选择 ${selected.provider!.name}`;
    return {
      virtualModelId: id,
      providerId: selected.member.providerId,
      modelId: selected.member.modelId,
      routingMode: virtualModel.routingMode,
      reason,
    };
  }

  async getWritingModelProfile(): Promise<RuntimeWritingModelProfile> {
    const state = await this.loadState();
    return clone(state.writingModelProfile);
  }

  async updateWritingModelProfile(profile: RuntimeWritingModelProfileInput): Promise<RuntimeWritingModelProfile> {
    const state = await this.loadState();
    const updated = normalizeWritingModelProfile(profile, state.virtualModels.map((model) => model.id));
    state.writingModelProfile = updated;
    state.updatedAt = nowIso();
    await this.saveState(state);
    return clone(updated);
  }
}
