/**
 * API Token Authentication Middleware
 *
 * 为外部调用方（如羽书 QQ bot）提供简单的 Bearer Token 认证。
 * Token 从用户配置中读取。未配置 token 时跳过认证（向后兼容）。
 *
 * 使用方式：
 * 1. 在设置中配置 API Token（设置 → 服务器与系统 → API Token）
 * 2. 外部调用时在 Header 中携带：Authorization: Bearer <token>
 * 3. 浏览器前端请求（同源）不需要 token
 */

import type { Context, Next } from "hono";

let cachedToken: string | null | undefined = undefined;

async function getApiToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    const { loadUserConfig } = await import("./user-config-service.js");
    const config = await loadUserConfig();
    cachedToken = (config as unknown as Record<string, unknown>).apiToken as string | null ?? null;
    // Refresh cache every 60s
    setTimeout(() => { cachedToken = undefined; }, 60_000);
    return cachedToken;
  } catch {
    cachedToken = null;
    return null;
  }
}

/**
 * Bearer Token 认证中间件。
 * - 未配置 token → 跳过认证（所有请求放行）
 * - 已配置 token → 要求 Authorization: Bearer <token>
 * - 同源请求（Referer/Origin 匹配 localhost）→ 跳过认证（前端不受影响）
 */
export async function apiTokenAuth(c: Context, next: Next): Promise<Response | void> {
  const token = await getApiToken();

  // 未配置 token — 跳过认证
  if (!token) {
    return next();
  }

  // 同源请求（浏览器前端）— 跳过认证
  const origin = c.req.header("origin") ?? "";
  const referer = c.req.header("referer") ?? "";
  if (origin.includes("localhost") || origin.includes("127.0.0.1") || referer.includes("localhost") || referer.includes("127.0.0.1")) {
    // 检查是否是浏览器请求（有 sec-fetch-site 或 accept 含 text/html）
    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
      return next();
    }
  }

  // 检查 Authorization header
  const authHeader = c.req.header("authorization") ?? "";
  if (authHeader === `Bearer ${token}`) {
    return next();
  }

  // 认证失败
  return c.json({ error: "unauthorized", message: "Invalid or missing API token. Use Authorization: Bearer <token>" }, 401);
}

/** 清除缓存的 token（配置更新时调用） */
export function clearApiTokenCache(): void {
  cachedToken = undefined;
}
