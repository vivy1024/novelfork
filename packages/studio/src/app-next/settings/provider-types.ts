import type { ManagedProvider, Model } from "@/shared/provider-catalog";

export type PlatformId = "codex" | "kiro" | "cline";

export type PlatformImportMethod = "json-account" | "local-auth-json" | "oauth" | "device-code";

export interface PlatformIntegrationCatalogItem {
  readonly id: PlatformId;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly supportedImportMethods: readonly PlatformImportMethod[];
  readonly modelCount?: number;
}

export type PlatformAccountAuthMode = "json-account" | "local-auth-json" | "oauth" | "device-code";

export type PlatformAccountStatus = "active" | "disabled" | "expired" | "error";

export interface PlatformAccount {
  readonly id: string;
  readonly platformId: PlatformId;
  readonly displayName: string;
  readonly email?: string;
  readonly accountId?: string;
  readonly authMode: PlatformAccountAuthMode;
  readonly planType?: string;
  readonly status: PlatformAccountStatus;
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
}

export interface PlatformJsonImportPayload {
  readonly accountJson: unknown;
  readonly displayName?: string;
}

export type ApiProvider = ManagedProvider;
export type ApiModel = Model;
