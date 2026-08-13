import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ApiRequestError,
  apiQueryKey,
  buildApiUrl,
  deriveInvalidationPaths,
  fetchJson,
} from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";

export {
  ApiRequestError,
  buildApiUrl,
  deriveInvalidationPaths,
  fetchJson,
} from "@/lib/api-client";

/**
 * 失效指定 API 路径的缓存并触发重新拉取。
 * 所有通过 useApi 订阅同一路径的组件共享同一份缓存，失效后只回源一次。
 */
export function invalidateApiPaths(paths: ReadonlyArray<string>): void {
  for (const path of new Set(paths)) {
    const url = buildApiUrl(path);
    if (!url) continue;
    // 精确匹配无 query 的 url，并匹配带 query string 的变体（如 /jingwei/entries?category=…），
    // 但排除更深层路径（/jingwei/entries/xxx），避免误伤单条资源缓存。
    void queryClient.invalidateQueries({
      queryKey: ["api"],
      predicate: (query) => {
        const keyUrl = query.queryKey[1];
        return typeof keyUrl === "string" && (keyUrl === url || keyUrl.startsWith(`${url}?`));
      },
    });
  }
}

/**
 * 读取型 API 数据获取 hook。对外签名（data/loading/error/refetch）与旧实现一致，
 * 内部由 react-query 提供缓存去重、失效联动与卸载安全。
 */
export function useApi<T>(path: string | null) {
  const url = path === null ? null : buildApiUrl(path);
  const query = useQuery({
    queryKey: url ? apiQueryKey(url) : ["api", "__disabled__"],
    queryFn: () => fetchJson<T>(url as string),
    enabled: url !== null,
  });

  const refetch = useCallback(async () => {
    if (url === null) return;
    await query.refetch();
  }, [url, query.refetch]);

  const error = query.error
    ? query.error instanceof Error
      ? query.error.message
      : String(query.error)
    : null;

  return {
    data: (query.data ?? null) as T | null,
    loading: url !== null && query.isFetching,
    error,
    refetch,
  };
}

export async function postApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  invalidateApiPaths(deriveInvalidationPaths(path));
  return result;
}

export async function putApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  invalidateApiPaths(deriveInvalidationPaths(path));
  return result;
}
