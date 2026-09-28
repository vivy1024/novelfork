import { appendApiQuery, buildNarratorsApiPath } from "../backend-contract/api-paths";
import { runtimeJson } from "./auth";

type RuntimeJson = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Runtime 章节（`/chapters/:id` 深链）对应的主叙述者；没有时返回 null。 */
export async function resolvePrimaryNarratorForChapter(
  chapterId: string,
  json: RuntimeJson = runtimeJson,
): Promise<string | null> {
  const page = await json<{ items?: Array<{ id?: string; variant?: string }> }>(
    appendApiQuery(buildNarratorsApiPath(), new URLSearchParams({ chapterId, limit: "100" })),
  );
  return page.items?.find((narrator) => narrator.variant === "primary" && narrator.id)?.id ?? null;
}
