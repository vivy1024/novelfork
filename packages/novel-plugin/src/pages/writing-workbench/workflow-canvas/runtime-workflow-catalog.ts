/**
 * 工作流编辑器与子代理工坊共用的 NarraFork Runtime 动态能力目录解析器。
 *
 * 职责：
 * 1. 解析 `GET /api/settings`（真实 Runtime 模型分组）或兼容数组/`{ models }`/`{ providers }` 形状的可用模型列表；
 * 2. 解析 `GET /api/custom-subagents`（Runtime 全局自定义子代理）与 `${apiBase}/subagents`（本书定制子代理）；
 * 3. 解析并合并 `GET /api/writing-skills` 与 `GET ${apiBase}/skills`（严格以 `skill.name` 为唯一键）；
 * 4. 从 `NOVEL_RUNTIME_TOOL_CATALOG` 提取 `risk !== "read"` 且 `runtimeStatus === "ready"` 的权威可授权写入工具目录。
 */

import { NOVEL_RUNTIME_TOOL_CATALOG, type NovelRuntimeToolRisk } from "../../../handlers/tool-registry.js";
import { getNovelToolRoutine } from "../../../handlers/tool-routines.js";

export interface RuntimeModelOption {
  /** 传给 Runtime 的模型标识，优先 `providerId:modelId`，无 providerId 时为 `modelId`。 */
  readonly value: string;
  /** 面向作者展示的可读名称：`providerName · modelName`。 */
  readonly label: string;
  readonly providerName?: string;
}

export type SubagentSourceKind = "builtin" | "book-custom" | "runtime-global";

export interface RuntimeGlobalSubagentItem {
  readonly name: string;
  readonly description: string;
  readonly prompt?: string;
  readonly model?: string;
}

export interface RuntimeSkillOption {
  /** Runtime Skill 工具按 SKILL.md 的 name 精确查找，不接受 slug / catalog id。 */
  readonly name: string;
  readonly description: string;
  readonly kind?: string;
  readonly source?: string;
}

export interface WritableNovelToolOption {
  readonly name: string;
  readonly nameZh: string;
  readonly descriptionZh: string;
  readonly risk: Exclude<NovelRuntimeToolRisk, "read">;
  readonly common: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 解析 `GET /api/providers/models` 的响应，过滤掉 `enabled === false` 的项并去重。
 */
export function parseRuntimeModelsResponse(payload: unknown): RuntimeModelOption[] {
  const seen = new Set<string>();
  const result: RuntimeModelOption[] = [];

  const pushModel = (raw: Record<string, unknown>, fallbackProviderId = "", fallbackProviderName = "") => {
    if (raw.enabled === false) return;
    const providerId =
      asNonEmptyString(raw.providerId) ||
      asNonEmptyString(raw.providerKey) ||
      (typeof raw.provider === "string" ? raw.provider.trim() : "") ||
      fallbackProviderId;
    const providerObj = asRecord(raw.provider);
    const resolvedProviderId = providerId || asNonEmptyString(providerObj?.id);
    if (providerObj?.enabled === false) return;

    const rawModelId =
      asNonEmptyString(raw.modelId) ||
      asNonEmptyString(raw.id) ||
      asNonEmptyString(raw.model) ||
      asNonEmptyString(raw.name);
    if (!rawModelId) return;

    const fullId = asNonEmptyString(raw.fullId) || asNonEmptyString(raw.key);
    const value = fullId.includes(":")
      ? fullId
      : rawModelId.includes(":") || !resolvedProviderId
        ? rawModelId
        : `${resolvedProviderId}:${rawModelId}`;

    if (!value || seen.has(value)) return;
    seen.add(value);

    const providerName =
      asNonEmptyString(raw.providerName) ||
      asNonEmptyString(raw.providerLabel) ||
      asNonEmptyString(providerObj?.name) ||
      fallbackProviderName ||
      resolvedProviderId;
    const modelName =
      asNonEmptyString(raw.modelName) ||
      asNonEmptyString(raw.displayName) ||
      asNonEmptyString(raw.label) ||
      asNonEmptyString(raw.name) ||
      (rawModelId.includes(":") ? rawModelId.split(":").slice(1).join(":") : rawModelId);

    const label = providerName && providerName !== modelName
      ? `${providerName} · ${modelName}`
      : modelName;

    result.push({
      value,
      label,
      ...(providerName ? { providerName } : {}),
    });
  };

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const rec = asRecord(item);
      if (rec) pushModel(rec);
    }
    return result;
  }

  const root = asRecord(payload);
  if (!root) return result;

  for (const key of ["models", "items", "data"] as const) {
    const list = root[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        const rec = asRecord(item);
        if (rec) pushModel(rec);
      }
    }
  }

  if (Array.isArray(root.providers)) {
    for (const p of root.providers) {
      const pRec = asRecord(p);
      if (!pRec || pRec.enabled === false) continue;
      const pId = asNonEmptyString(pRec.id) || asNonEmptyString(pRec.providerId);
      const pName = asNonEmptyString(pRec.name) || asNonEmptyString(pRec.label) || pId;
      if (Array.isArray(pRec.models)) {
        for (const m of pRec.models) {
          if (typeof m === "string" && m.trim()) {
            pushModel({ id: m.trim() }, pId, pName);
          } else {
            const mRec = asRecord(m);
            if (mRec) pushModel(mRec, pId, pName);
          }
        }
      }
    }
  }

  // 兼容 NarraFork Runtime 真实 `GET /api/settings` 响应的分组模型字段
  const hiddenSet = new Set<string>(
    Array.isArray(asRecord(root.agent)?.hiddenModels)
      ? ((asRecord(root.agent)!.hiddenModels as unknown[]).filter((v): v is string => typeof v === "string"))
      : [],
  );
  const groupedKeys = [
    "openaiModelsGrouped",
    "anthropicModelsGrouped",
    "geminiModelsGrouped",
    "nugModelsGrouped",
    "pluginProviderModelsGrouped",
  ] as const;
  for (const key of groupedKeys) {
    const groups = root[key];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const gRec = asRecord(group);
      if (!gRec || gRec.disabled === true || gRec.enabled === false) continue;
      const gPrefix = asNonEmptyString(gRec.prefix) || asNonEmptyString(gRec.providerId) || asNonEmptyString(gRec.id);
      const gName = asNonEmptyString(gRec.name) || asNonEmptyString(gRec.providerName) || gPrefix;
      if (!Array.isArray(gRec.models)) continue;
      for (const item of gRec.models) {
        if (typeof item === "string" && item.trim()) {
          const full = item.includes(":") || !gPrefix ? item.trim() : `${gPrefix}:${item.trim()}`;
          if (!hiddenSet.has(full)) pushModel({ id: item.trim() }, gPrefix, gName);
        } else {
          const mRec = asRecord(item);
          if (!mRec) continue;
          const mId = asNonEmptyString(mRec.id) || asNonEmptyString(mRec.modelId) || asNonEmptyString(mRec.model);
          const full = mId.includes(":") || !gPrefix ? mId : `${gPrefix}:${mId}`;
          if (full && !hiddenSet.has(full)) pushModel(mRec, gPrefix, gName);
        }
      }
    }
  }
  if (root.codexAvailable === true && Array.isArray(root.codexModels)) {
    for (const m of root.codexModels) {
      if (typeof m === "string" && m.trim() && !hiddenSet.has(`codex:${m.trim()}`)) {
        pushModel({ id: m.trim() }, "codex", "Codex");
      }
    }
  }
  if (root.commandcodeAvailable === true && Array.isArray(root.commandcodeModels)) {
    for (const m of root.commandcodeModels) {
      if (typeof m === "string" && m.trim() && !hiddenSet.has(`commandcode:${m.trim()}`)) {
        pushModel({ id: m.trim() }, "commandcode", "CommandCode");
      }
    }
  }

  return result;
}

/**
 * 解析 `GET /api/custom-subagents` 返回的 NarraFork Runtime 全局自定义子代理列表。
 */
export function parseRuntimeGlobalSubagentsResponse(payload: unknown): RuntimeGlobalSubagentItem[] {
  const list = Array.isArray(payload)
    ? payload
    : (() => {
        const root = asRecord(payload);
        if (!root) return [];
        for (const key of ["subagents", "customSubagents", "items", "data", "custom"] as const) {
          if (Array.isArray(root[key])) return root[key] as unknown[];
        }
        return [];
      })();

  const seen = new Set<string>();
  const out: RuntimeGlobalSubagentItem[] = [];
  for (const raw of list) {
    const rec = asRecord(raw);
    if (!rec || rec.enabled === false) continue;
    const name = asNonEmptyString(rec.name) || asNonEmptyString(rec.id);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = asNonEmptyString(rec.description) || asNonEmptyString(rec.summary);
    const prompt = asNonEmptyString(rec.prompt) || asNonEmptyString(rec.systemPrompt);
    const model = asNonEmptyString(rec.model) || asNonEmptyString(rec.defaultModel);
    out.push({
      name,
      description,
      ...(prompt ? { prompt } : {}),
      ...(model ? { model } : {}),
    });
  }
  return out;
}

/**
 * 合并 `GET /api/writing-skills` 与 `GET ${apiBase}/runtime/skills`，严格按 `skill.name` 去重。
 */
export function mergeRuntimeSkillsResponses(...payloads: readonly unknown[]): RuntimeSkillOption[] {
  const byName = new Map<string, RuntimeSkillOption>();

  const ingest = (payload: unknown) => {
    const list = Array.isArray(payload)
      ? payload
      : (() => {
          const root = asRecord(payload);
          if (!root) return [];
          for (const key of ["skills", "items", "data"] as const) {
            if (Array.isArray(root[key])) return root[key] as unknown[];
          }
          return [];
        })();

    for (const raw of list) {
      const rec = asRecord(raw);
      if (!rec || rec.enabled === false) continue;
      const name = asNonEmptyString(rec.name);
      if (!name) continue;
      const description = asNonEmptyString(rec.description);
      const kind = asNonEmptyString(rec.kind);
      const source = asNonEmptyString(rec.source);
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, {
          name,
          description,
          ...(kind ? { kind } : {}),
          ...(source ? { source } : {}),
        });
      } else if (!existing.description && description) {
        byName.set(name, {
          ...existing,
          description,
          ...(existing.kind ? {} : kind ? { kind } : {}),
        });
      }
    }
  };

  for (const payload of payloads) ingest(payload);
  return [...byName.values()];
}

const COMMON_WRITABLE_TOOL_ORDER = [
  "chapter.commit",
  "jingwei.write",
  "hooks.manage",
  "outline.volume",
  "memory.settle",
  "chapter.discard_range",
  "character.inspect",
] as const;

const COMMON_WRITABLE_SET = new Set<string>(COMMON_WRITABLE_TOOL_ORDER);

function summarizeToolDescription(description: string): string {
  const firstLine = description.split("\n")[0]?.trim() ?? "";
  const firstClause = firstLine.split(/[。；]/)[0]?.trim() ?? firstLine;
  return firstClause || description.slice(0, 48);
}

/**
 * 从 `NOVEL_RUNTIME_TOOL_CATALOG` 筛选 `risk !== "read"` 且 `runtimeStatus === "ready"` 的权威可授权写类工具目录。
 */
export const AUTHORITATIVE_WRITABLE_NOVEL_TOOLS: readonly WritableNovelToolOption[] = NOVEL_RUNTIME_TOOL_CATALOG
  .filter((entry): entry is typeof entry & { readonly risk: Exclude<NovelRuntimeToolRisk, "read"> } =>
    entry.risk !== "read" && entry.runtimeStatus === "ready",
  )
  .map((entry) => {
    const routine = getNovelToolRoutine(entry.name);
    return {
      name: entry.name,
      nameZh: routine?.nameZh ?? entry.name,
      descriptionZh: routine?.descriptionZh ?? summarizeToolDescription(entry.description),
      risk: entry.risk,
      common: COMMON_WRITABLE_SET.has(entry.name),
    };
  })
  .sort((a, b) => {
    const ai = COMMON_WRITABLE_TOOL_ORDER.indexOf(a.name as (typeof COMMON_WRITABLE_TOOL_ORDER)[number]);
    const bi = COMMON_WRITABLE_TOOL_ORDER.indexOf(b.name as (typeof COMMON_WRITABLE_TOOL_ORDER)[number]);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

export async function fetchJsonSafe(url: string): Promise<unknown> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}
