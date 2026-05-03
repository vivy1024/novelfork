import type { ModelAggregation, ModelAggregationMember } from "../../types/settings.js";
import { loadUserConfig, updateUserConfig } from "./user-config-service.js";
import { buildRuntimeModelPool } from "./runtime-model-pool.js";
import { ProviderRuntimeStore } from "./provider-runtime-store.js";

export const AGGREGATION_ID_PREFIX = "agg:";

/** round-robin 计数器（进程内） */
const roundRobinCounters = new Map<string, number>();

export function isAggregationId(id: string): boolean {
  return id.startsWith(AGGREGATION_ID_PREFIX);
}

export async function listAggregations(): Promise<ModelAggregation[]> {
  const config = await loadUserConfig();
  return config.modelDefaults.aggregations;
}

export async function getAggregation(id: string): Promise<ModelAggregation | undefined> {
  const aggregations = await listAggregations();
  return aggregations.find((agg) => agg.id === id);
}

export async function createAggregation(input: Omit<ModelAggregation, "id"> & { id?: string }): Promise<ModelAggregation> {
  const config = await loadUserConfig();
  const aggregations = [...config.modelDefaults.aggregations];

  const id = input.id ?? `${AGGREGATION_ID_PREFIX}${Date.now().toString(36)}`;
  if (aggregations.some((agg) => agg.id === id)) {
    throw new Error(`Aggregation already exists: ${id}`);
  }

  const sortedMembers = [...input.members].sort((a, b) => a.priority - b.priority);
  const aggregation: ModelAggregation = {
    id,
    displayName: input.displayName,
    members: sortedMembers,
    routingStrategy: input.routingStrategy,
  };

  aggregations.push(aggregation);
  await updateUserConfig({ modelDefaults: { aggregations } });
  return aggregation;
}

export async function updateAggregation(id: string, updates: Partial<Omit<ModelAggregation, "id">>): Promise<ModelAggregation> {
  const config = await loadUserConfig();
  const aggregations = [...config.modelDefaults.aggregations];
  const index = aggregations.findIndex((agg) => agg.id === id);
  if (index === -1) {
    throw new Error(`Aggregation not found: ${id}`);
  }

  const current = aggregations[index];
  const members = updates.members
    ? [...updates.members].sort((a, b) => a.priority - b.priority)
    : current.members;

  const updated: ModelAggregation = {
    ...current,
    ...updates,
    id,
    members,
  };
  aggregations[index] = updated;
  await updateUserConfig({ modelDefaults: { aggregations } });
  return updated;
}

export async function deleteAggregation(id: string): Promise<void> {
  const config = await loadUserConfig();
  const aggregations = config.modelDefaults.aggregations.filter((agg) => agg.id !== id);
  if (aggregations.length === config.modelDefaults.aggregations.length) {
    throw new Error(`Aggregation not found: ${id}`);
  }
  roundRobinCounters.delete(id);
  await updateUserConfig({ modelDefaults: { aggregations } });
}

export interface ResolvedMember {
  providerId: string;
  modelId: string;
}

export interface AggregationResolveOptions {
  readonly store?: ProviderRuntimeStore;
}

/**
 * 根据聚合配置和路由策略，解析出实际的 providerId + modelId。
 * 返回 undefined 表示所有成员都不可用。
 */
export async function resolveAggregation(
  aggregation: ModelAggregation,
  options: AggregationResolveOptions = {},
): Promise<ResolvedMember | undefined> {
  const store = options.store ?? new ProviderRuntimeStore();
  const modelPool = await buildRuntimeModelPool(store);
  const availableSet = new Set(modelPool.filter((e) => e.enabled).map((e) => e.modelId));

  const availableMembers = aggregation.members.filter((member) =>
    availableSet.has(`${member.providerId}:${member.modelId}`),
  );

  if (availableMembers.length === 0) return undefined;

  const picked = pickMember(aggregation.id, aggregation.routingStrategy, availableMembers);
  return { providerId: picked.providerId, modelId: picked.modelId };
}

function pickMember(
  aggregationId: string,
  strategy: ModelAggregation["routingStrategy"],
  members: ModelAggregationMember[],
): ModelAggregationMember {
  switch (strategy) {
    case "priority":
      return members[0]; // already sorted by priority

    case "round-robin": {
      const counter = (roundRobinCounters.get(aggregationId) ?? 0) % members.length;
      roundRobinCounters.set(aggregationId, counter + 1);
      return members[counter];
    }

    case "random":
      return members[Math.floor(Math.random() * members.length)];

    default:
      return members[0];
  }
}

/** 重置 round-robin 计数器（测试用） */
export function resetRoundRobinCounters(): void {
  roundRobinCounters.clear();
}
