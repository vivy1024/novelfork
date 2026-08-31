import { fetchJson } from "../../hooks/use-api";

export interface AuthorWritingProfile {
  readonly version: 1;
  readonly habits: string;
  readonly styleNotes: string;
  readonly avoidances: readonly string[];
  readonly updatedAt?: string;
}

export interface AuthorWritingProfileResponse {
  readonly profile: AuthorWritingProfile;
}

export function createAuthorWritingProfileClient() {
  return {
    get: () => fetchJson<AuthorWritingProfileResponse>("/api/author-profile"),
    save: (profile: Pick<AuthorWritingProfile, "habits" | "styleNotes" | "avoidances">) =>
      fetchJson<AuthorWritingProfileResponse>("/api/author-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      }),
  } as const;
}
