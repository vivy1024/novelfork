import {
  createRuntimeAdminRequest,
  encodePathSegment,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export interface NotificationSoundUploadResult {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
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
  } as const;
}
