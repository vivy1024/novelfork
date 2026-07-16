import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export type RuntimeUserRole = "admin" | "user";

export interface RuntimeAdminUser {
  readonly id: string;
  readonly username: string;
  readonly role: RuntimeUserRole;
  readonly avatarColor: string | null;
  readonly avatarImageId: string | null;
  readonly disabledAt: string | null;
  readonly createdAt: string;
}

export interface RuntimeCurrentUser {
  readonly id: string;
  readonly username: string;
  readonly role: RuntimeUserRole;
}

export interface RuntimeRegistrationSettings {
  readonly registrationOpen: boolean;
}

export interface RuntimeUsersSnapshot {
  readonly currentUser: RuntimeCurrentUser;
  readonly users: ReadonlyArray<RuntimeAdminUser>;
  readonly registrationOpen: boolean;
}

export interface UpdateRuntimeUserInput {
  readonly username?: string;
  readonly password?: string;
  readonly role?: RuntimeUserRole;
  readonly disabled?: boolean;
}

export function createUsersClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  const getCurrentUser = () => request<RuntimeCurrentUser>("/api/auth/me");
  const listUsers = () => request<RuntimeAdminUser[]>("/api/admin/users");
  const getRegistrationSettings = async (): Promise<RuntimeRegistrationSettings> => {
    const settings = await request<{ auth: RuntimeRegistrationSettings }>("/api/settings");
    return settings.auth;
  };

  return {
    getCurrentUser,
    listUsers,
    getRegistrationSettings,
    getSnapshot: async (): Promise<RuntimeUsersSnapshot> => {
      const [currentUser, users, registration] = await Promise.all([
        getCurrentUser(),
        listUsers(),
        getRegistrationSettings(),
      ]);
      return { currentUser, users, registrationOpen: registration.registrationOpen };
    },
    updateRegistrationOpen: (registrationOpen: boolean) =>
      request<RuntimeRegistrationSettings>(
        "/api/admin/settings",
        jsonRequest("PATCH", { registrationOpen }),
      ),
    updateUser: (id: string, input: UpdateRuntimeUserInput) =>
      request<Partial<RuntimeAdminUser> & Pick<RuntimeAdminUser, "id" | "username" | "role">>(
        `/api/admin/users/${encodePathSegment(id)}`,
        jsonRequest("PATCH", input),
      ),
    deleteUser: (id: string) =>
      request<OkResponse>(`/api/admin/users/${encodePathSegment(id)}`, { method: "DELETE" }),
  } as const;
}

export type UsersClient = ReturnType<typeof createUsersClient>;
