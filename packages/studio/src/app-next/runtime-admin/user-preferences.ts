import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export type NotificationSoundType = "builtin" | "custom";
export type MaskedPreferenceSecret = string;
export type QueueMode = "turn" | "tool" | "interrupt";

export interface RuntimeUserCommandParam {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
}

export interface RuntimeUserCommandModelOverride {
  readonly model: string;
  readonly mode: "temporary" | "permanent";
}

export interface RuntimeUserCommand {
  readonly name: string;
  readonly prompt: string;
  readonly description?: string;
  readonly runBashFirst?: boolean;
  readonly bashCommand?: string;
  readonly params?: readonly RuntimeUserCommandParam[];
  readonly modelOverride?: RuntimeUserCommandModelOverride;
}

export interface UserPreferenceAppearanceFields {
  readonly autoLoadOlderMessages: boolean;
  readonly fastModeDefault: boolean;
  readonly language: string;
  readonly wordWrapMarkdown: boolean;
  readonly wordWrapCode: boolean;
  readonly wordWrapDiff: boolean;
  readonly replyInUserLanguage: boolean;
  readonly showTokenUsage: boolean;
  readonly showOutputStats: boolean;
  readonly terminalTheme: string;
  readonly terminalFontSize: number;
  readonly addSubagentToRecentTabs: boolean;
  readonly enterQueueMode: QueueMode;
  readonly ctrlEnterQueueMode: QueueMode;
}

export interface UserPreferenceNotificationFields {
  readonly notifyOnDone: boolean;
  readonly notifyOnWaiting: boolean;
  readonly notifyPwaEnabled: boolean;
  readonly notifySoundEnabled: boolean;
  readonly notifySoundType: NotificationSoundType;
  readonly notifySoundBuiltin: string;
  readonly notifySoundFileId: string | null;
  readonly notifyDingtalkEnabled: boolean;
  readonly notifyDingtalkWebhook: MaskedPreferenceSecret;
  readonly notifyDingtalkSecret: MaskedPreferenceSecret;
  readonly notifyFeishuEnabled: boolean;
  readonly notifyFeishuWebhook: MaskedPreferenceSecret;
  readonly notifyFeishuSecret: MaskedPreferenceSecret;
}

export interface RuntimeUserPreferences
  extends UserPreferenceAppearanceFields,
    UserPreferenceNotificationFields {
  readonly id?: string;
  readonly userId?: string;
  readonly commands: readonly RuntimeUserCommand[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

/** Send only changed fields so masked notification credentials are not unnecessarily resent. */
export type UserPreferencesPatch = Partial<
  UserPreferenceAppearanceFields & UserPreferenceNotificationFields & {
    readonly commands: readonly RuntimeUserCommand[];
  }
>;

export function createUserPreferencesClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<RuntimeUserPreferences>("/api/user-preferences"),
    put: (preferences: UserPreferencesPatch) =>
      request<RuntimeUserPreferences>(
        "/api/user-preferences",
        jsonRequest("PUT", preferences),
      ),
    patch: (patch: UserPreferencesPatch) =>
      request<RuntimeUserPreferences>(
        "/api/user-preferences",
        jsonRequest("PATCH", patch),
      ),
  } as const;
}
