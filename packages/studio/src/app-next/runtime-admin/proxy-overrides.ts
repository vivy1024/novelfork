import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";
import type { RuntimeHook } from "./hooks";
import type { RuntimeProxySettings, RuntimeSettings, RuntimeSettingsSection } from "./settings";

export type RuntimeProxyOverrideMode = "default" | "direct" | "system" | "custom";

export interface RuntimeProxyOverride extends RuntimeSettingsSection {
  readonly mode: RuntimeProxyOverrideMode;
  readonly url?: string;
}

export type RuntimeProviderProxySection =
  | "customApiProviders"
  | "openaiProviders"
  | "anthropicProviders"
  | "nugProviders"
  | "clineProviders";

export type RuntimeProviderProxyTarget =
  | {
      readonly kind: "builtin";
      readonly key: "kiro" | "codex";
      readonly name: string;
      readonly proxy: RuntimeProxyOverride;
    }
  | {
      readonly kind: "provider";
      readonly section: RuntimeProviderProxySection;
      readonly id: string;
      readonly name: string;
      readonly badge: string;
      readonly proxy: RuntimeProxyOverride;
    };

export interface RuntimeGatewayProxyTarget {
  readonly platform: string;
  readonly proxy: RuntimeProxyOverride;
}

export interface RuntimeHookProxyTarget {
  readonly id: string;
  readonly name: string;
  readonly scope: "global" | "project";
  readonly proxy: RuntimeProxyOverride;
}

export interface RuntimeProxyOverridesSnapshot {
  readonly outbound: RuntimeProxySettings;
  readonly providers: readonly RuntimeProviderProxyTarget[];
  readonly gateways: readonly RuntimeGatewayProxyTarget[];
  readonly hooks: readonly RuntimeHookProxyTarget[];
}

interface ProviderLike extends RuntimeSettingsSection {
  readonly id: string;
  readonly name?: string;
  readonly prefix?: string;
  readonly proxy?: RuntimeProxyOverride;
}

interface GatewayPlatformLike extends RuntimeSettingsSection {
  readonly platform: string;
  readonly proxy?: RuntimeProxyOverride;
}

interface GatewayPreferences {
  readonly gatewayConfig?: RuntimeSettingsSection & {
    readonly platforms?: readonly GatewayPlatformLike[];
  };
}

function proxyOverride(value: unknown): RuntimeProxyOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { mode: "default" };
  const candidate = value as { mode?: unknown; url?: unknown };
  const mode = candidate.mode;
  if (mode !== "direct" && mode !== "system" && mode !== "custom") return { mode: "default" };
  return mode === "custom" && typeof candidate.url === "string"
    ? { mode, url: candidate.url }
    : { mode };
}

function normalizeOverride(value: RuntimeProxyOverride): RuntimeProxyOverride {
  return value.mode === "custom"
    ? { mode: "custom", url: value.url?.trim() ?? "" }
    : { mode: value.mode };
}

function providerLabel(provider: ProviderLike): string {
  return provider.name?.trim() || provider.prefix?.trim() || provider.id;
}

function providerTargets(settings: RuntimeSettings): RuntimeProviderProxyTarget[] {
  const targets: RuntimeProviderProxyTarget[] = [
    { kind: "builtin", key: "kiro", name: "Kiro", proxy: proxyOverride(settings.kiro?.proxy) },
    { kind: "builtin", key: "codex", name: "Codex", proxy: proxyOverride(settings.codex?.proxy) },
  ];
  const canonicalProviders = settings.customApiProviders ?? [];
  const groups: ReadonlyArray<{
    section: RuntimeProviderProxySection;
    badge: string;
    providers: readonly ProviderLike[];
  }> = [
    ...(canonicalProviders.length > 0
      ? [{ section: "customApiProviders" as const, badge: "Custom API", providers: canonicalProviders }]
      : [
          { section: "openaiProviders" as const, badge: "OpenAI", providers: settings.openaiProviders ?? [] },
          { section: "anthropicProviders" as const, badge: "Anthropic", providers: settings.anthropicProviders ?? [] },
        ]),
    { section: "nugProviders", badge: "NUG", providers: settings.nugProviders ?? [] },
    { section: "clineProviders", badge: "Cline", providers: settings.clineProviders ?? [] },
  ];

  for (const group of groups) {
    for (const provider of group.providers) {
      targets.push({
        kind: "provider",
        section: group.section,
        id: provider.id,
        name: providerLabel(provider),
        badge: group.badge,
        proxy: proxyOverride(provider.proxy),
      });
    }
  }
  return targets;
}

function gatewayTargets(preferences: GatewayPreferences): RuntimeGatewayProxyTarget[] {
  return (preferences.gatewayConfig?.platforms ?? []).map((platform) => ({
    platform: platform.platform,
    proxy: proxyOverride(platform.proxy),
  }));
}

function hookTargets(hooks: readonly RuntimeHook[]): RuntimeHookProxyTarget[] {
  return hooks
    .filter((hook) => hook.type === "http")
    .map((hook) => ({
      id: hook.id,
      name: hook.url?.trim() || hook.id,
      scope: hook.projectId ? "project" : "global",
      proxy: proxyOverride(
        hook.proxyMode
          ? { mode: hook.proxyMode, url: hook.proxyUrl ?? undefined }
          : undefined,
      ),
    }));
}

export function createProxyOverridesClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);

  return {
    async get(): Promise<RuntimeProxyOverridesSnapshot> {
      const [settings, preferences, hooks] = await Promise.all([
        request<RuntimeSettings>("/api/settings"),
        request<GatewayPreferences>("/api/user-preferences"),
        request<readonly RuntimeHook[]>("/api/hooks/all"),
      ]);
      return {
        outbound: settings.proxy ?? { mode: "system" },
        providers: providerTargets(settings),
        gateways: gatewayTargets(preferences),
        hooks: hookTargets(hooks),
      };
    },

    updateOutbound: (proxy: RuntimeProxySettings) =>
      request<RuntimeSettings>(
        "/api/settings",
        jsonRequest("PATCH", { proxy: normalizeOverride(proxy as RuntimeProxyOverride) }),
      ),

    async updateProvider(
      target: RuntimeProviderProxyTarget,
      proxy: RuntimeProxyOverride,
    ): Promise<RuntimeSettings> {
      const normalized = normalizeOverride(proxy);
      if (target.kind === "builtin") {
        return request<RuntimeSettings>(
          "/api/settings",
          jsonRequest("PATCH", { [target.key]: { proxy: normalized } }),
        );
      }

      const settings = await request<RuntimeSettings>("/api/settings");
      const providers = (settings[target.section] ?? []) as readonly ProviderLike[];
      if (!providers.some((provider) => provider.id === target.id)) {
        throw new Error(`Runtime 中不存在供应商 ${target.id}`);
      }
      const updated = providers.map((provider) =>
        provider.id === target.id
          ? {
              ...provider,
              proxy: normalized.mode === "default" ? undefined : normalized,
            }
          : provider,
      );
      return request<RuntimeSettings>(
        "/api/settings",
        jsonRequest("PATCH", { [target.section]: updated }),
      );
    },

    async updateGateway(platform: string, proxy: RuntimeProxyOverride): Promise<void> {
      const preferences = await request<GatewayPreferences>("/api/user-preferences");
      const gatewayConfig = preferences.gatewayConfig ?? {};
      const platforms = gatewayConfig.platforms ?? [];
      if (!platforms.some((item) => item.platform === platform)) {
        throw new Error(`Runtime 中不存在 Gateway 平台 ${platform}`);
      }
      const normalized = normalizeOverride(proxy);
      const updatedPlatforms = platforms.map((item) =>
        item.platform === platform
          ? {
              ...item,
              proxy: normalized.mode === "default" ? undefined : normalized,
            }
          : item,
      );
      await request(
        "/api/user-preferences",
        jsonRequest("PATCH", {
          gatewayConfig: { ...gatewayConfig, platforms: updatedPlatforms },
        }),
      );
      await request(
        "/api/gateway/reload",
        jsonRequest("POST", { platforms: [platform] }),
      ).catch(() => undefined);
    },

    updateHook: (id: string, proxy: RuntimeProxyOverride) => {
      const normalized = normalizeOverride(proxy);
      return request<RuntimeHook>(
        `/api/hooks/${encodeURIComponent(id)}`,
        jsonRequest("PUT", {
          proxyMode: normalized.mode === "default" ? null : normalized.mode,
          proxyUrl: normalized.mode === "custom" ? normalized.url || null : null,
        }),
      );
    },
  } as const;
}
