/**
 * RuntimeSettings — 统一配置来源/作用域合并模型
 *
 * 每个设置项记录 value、source、scope、status、lastUpdated、error。
 * 合并顺序：session > project > user > imported > default（高优先级覆盖低优先级）。
 */

export const RUNTIME_SETTINGS_SOURCE_PRIORITY = ["session", "project", "user", "imported", "default"] as const;

export type RuntimeSettingsSource = (typeof RUNTIME_SETTINGS_SOURCE_PRIORITY)[number];

export type RuntimeSettingsScope = "global" | "project" | "session";

export type RuntimeSettingsStatus = "current" | "unconfigured" | "partial" | "planned" | "reference-only" | "unsupported" | "unknown";

export interface RuntimeSettingsEntryValue {
  readonly value: unknown;
  readonly status: RuntimeSettingsStatus;
  readonly error?: string;
  readonly lastUpdated?: string;
}

export interface RuntimeSettingsLayer {
  readonly source: RuntimeSettingsSource;
  readonly scope: RuntimeSettingsScope;
  readonly entries: Readonly<Record<string, RuntimeSettingsEntryValue>>;
}

export interface RuntimeSettingsEntry {
  readonly key: string;
  readonly value: unknown;
  readonly source: RuntimeSettingsSource;
  readonly scope: RuntimeSettingsScope;
  readonly status: RuntimeSettingsStatus;
  readonly error?: string;
  readonly lastUpdated?: string;
  readonly overrides?: readonly { readonly source: RuntimeSettingsSource; readonly value: unknown }[];
}

export type RuntimeSettingsMap = Readonly<Record<string, RuntimeSettingsEntry>>;

/**
 * 按来源优先级合并多个配置层，返回每个 key 的最终值与来源元数据。
 */
export function mergeRuntimeSettings(layers: readonly RuntimeSettingsLayer[]): RuntimeSettingsMap {
  // Sort by descending priority index (default first, session last) so higher-priority layers overwrite lower ones.
  const sortedLayers = [...layers].sort(
    (a, b) => RUNTIME_SETTINGS_SOURCE_PRIORITY.indexOf(b.source) - RUNTIME_SETTINGS_SOURCE_PRIORITY.indexOf(a.source),
  );

  const result: Record<string, RuntimeSettingsEntry> = {};

  for (const layer of sortedLayers) {
    for (const [key, entry] of Object.entries(layer.entries)) {
      result[key] = {
        key,
        value: entry.value,
        source: layer.source,
        scope: layer.scope,
        status: entry.status,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.lastUpdated ? { lastUpdated: entry.lastUpdated } : {}),
      };
    }
  }

  return result;
}

/**
 * 解析单个 key 的完整来源链（包含被覆盖的低优先级值）。
 */
export function resolveRuntimeSettingsEntry(
  key: string,
  layers: readonly RuntimeSettingsLayer[],
): RuntimeSettingsEntry | null {
  const sortedLayers = [...layers].sort(
    (a, b) => RUNTIME_SETTINGS_SOURCE_PRIORITY.indexOf(a.source) - RUNTIME_SETTINGS_SOURCE_PRIORITY.indexOf(b.source),
  );

  let winner: RuntimeSettingsEntry | null = null;
  const overrides: Array<{ source: RuntimeSettingsSource; value: unknown }> = [];

  for (const layer of sortedLayers) {
    const entry = layer.entries[key];
    if (!entry) continue;

    if (winner) {
      overrides.push({ source: layer.source, value: entry.value });
    } else {
      winner = {
        key,
        value: entry.value,
        source: layer.source,
        scope: layer.scope,
        status: entry.status,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.lastUpdated ? { lastUpdated: entry.lastUpdated } : {}),
      };
    }
  }

  if (!winner) return null;

  return overrides.length > 0 ? { ...winner, overrides } : winner;
}
