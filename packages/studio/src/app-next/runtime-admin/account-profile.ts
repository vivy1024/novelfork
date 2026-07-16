import {
  createRuntimeAdminRequest,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";
import { runtimeFetch } from "../runtime/auth";

export type AccountRole = "admin" | "user";

export interface AccountProfile {
  readonly id: string;
  readonly username: string;
  readonly role: AccountRole;
  readonly avatarColor: string | null;
  readonly avatarImageId: string | null;
  readonly gitUsername: string | null;
  readonly gitEmail: string | null;
  readonly createdAt: string;
}

/** The Runtime currently allows profile updates only for Git identity fields. */
export interface AccountProfilePatch {
  readonly gitUsername?: string;
  readonly gitEmail?: string;
}

export interface AvatarUploadResult extends OkResponse {
  readonly avatarImageId: string;
}

export function createAccountProfileClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<AccountProfile>("/api/auth/me"),
    patch: (patch: AccountProfilePatch) =>
      request<OkResponse>("/api/auth/me", jsonRequest("PATCH", patch)),
    uploadAvatar: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return request<AvatarUploadResult>("/api/auth/me/avatar", {
        method: "PATCH",
        body: formData,
      });
    },
    deleteAvatar: () => request<OkResponse>("/api/auth/me/avatar", { method: "DELETE" }),
    getAvatarBlob: async (userId: string, avatarImageId: string) => {
      const response = await runtimeFetch(
        `/api/uploads/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarImageId)}`,
        {},
        { fetchImpl: options.fetchImpl },
      );
      if (!response.ok) {
        throw new Error(`头像读取失败（${response.status}）`);
      }
      return response.blob();
    },
  } as const;
}
