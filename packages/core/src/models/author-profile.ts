import { z } from "zod";

export const AuthorProfileSchema = z.object({
  version: z.literal(1).default(1),
  habits: z.string().default(""),
  styleNotes: z.string().default(""),
  avoidances: z.array(z.string()).default([]),
  updatedAt: z.string().optional(),
});

export type AuthorProfile = z.infer<typeof AuthorProfileSchema>;

export function emptyAuthorProfile(): AuthorProfile {
  return AuthorProfileSchema.parse({});
}

export function parseAuthorProfile(value: unknown): AuthorProfile {
  if (typeof value === "string") {
    try {
      return AuthorProfileSchema.parse(JSON.parse(value));
    } catch {
      return emptyAuthorProfile();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyAuthorProfile();
  }
  const parsed = AuthorProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyAuthorProfile();
}

export function formatAuthorProfileForInjection(profile: AuthorProfile | null | undefined): string {
  if (!profile) return "";
  const lines: string[] = [];
  const habits = profile.habits.trim();
  const styleNotes = profile.styleNotes.trim();
  const avoidances = profile.avoidances.map((item) => item.trim()).filter(Boolean);
  if (habits) lines.push(habits);
  if (styleNotes) {
    if (lines.length > 0) lines.push("");
    lines.push(styleNotes);
  }
  if (avoidances.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("习惯性回避：");
    for (const item of avoidances) lines.push(`- ${item}`);
  }
  return lines.join("\n").trim();
}
