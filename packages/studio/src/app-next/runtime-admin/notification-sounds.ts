import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export interface NotificationSoundUploadResult {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
}

/**
 * Runtime reports a webhook probe as `ok` plus one of several diagnostic fields
 * depending on where the delivery failed (local validation, signing, upstream
 * response). Keep every variant so the panel can surface the real reason.
 */
export interface NotificationWebhookTestResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly reason?: string;
  readonly error?: string;
  readonly message?: string;
}

export function createNotificationSoundsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    upload: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return request<NotificationSoundUploadResult>("/api/notification-sounds", {
        method: "POST",
        body: formData,
      });
    },
    delete: (id: string) =>
      request<OkResponse>(`/api/notification-sounds/${encodePathSegment(id)}`, {
        method: "DELETE",
      }),
    testDingtalk: (webhook: string, secret?: string) =>
      request<NotificationWebhookTestResult>(
        "/api/notifications/test-dingtalk",
        jsonRequest("POST", { webhook, secret }),
      ),
    testFeishu: (webhook: string, secret?: string) =>
      request<NotificationWebhookTestResult>(
        "/api/notifications/test-feishu",
        jsonRequest("POST", { webhook, secret }),
      ),
  } as const;
}
