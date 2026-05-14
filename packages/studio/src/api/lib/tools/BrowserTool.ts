/**
 * BrowserTool - Playwright 浏览器自动化工具
 * 使用懒加载导入，Playwright 未安装时优雅降级
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";

interface BrowserSession {
  page: any;
  browser: any;
  lastAccess: number;
}

// 会话注册表
const sessions = new Map<string, BrowserSession>();
const MAX_BROWSER_SESSIONS = 5;

// 自动清理：5 分钟空闲关闭
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const cleanupInterval = setInterval(async () => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
      try { await session.browser.close(); } catch { /* ignore */ }
      sessions.delete(id); // Always delete, even if close fails
    }
  }
}, 60_000);

// 防止 interval 阻止进程退出
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

function getSession(sessionId: string | undefined): BrowserSession | null {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (session) {
    session.lastAccess = Date.now();
  }
  return session ?? null;
}

function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("169.254.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.") || hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") || hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") || hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") || hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") || hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") || hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") || hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") || hostname.startsWith("172.31.") ||
      hostname === "[::1]" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    );
  } catch { return true; }
}

export const BrowserTool: ToolDefinition = {
  name: "Browser",
  description: "控制浏览器执行操作（导航、点击、截图、提取文本等）",
  parameters: [
    {
      name: "action",
      type: "string",
      required: true,
      description:
        "操作类型: launch | navigate | click | fill | screenshot | get_text | evaluate | close",
    },
    {
      name: "url",
      type: "string",
      required: false,
      description: "URL（launch/navigate 时使用）",
    },
    {
      name: "session_id",
      type: "string",
      required: false,
      description: "浏览器会话 ID（非 launch 操作必需）",
    },
    {
      name: "selector",
      type: "string",
      required: false,
      description: "CSS 选择器（click/fill/get_text 时使用）",
    },
    {
      name: "value",
      type: "string",
      required: false,
      description: "输入值（fill/evaluate 时使用）",
    },
    {
      name: "timeout",
      type: "number",
      required: false,
      description: "超时毫秒数（默认 30000）",
      default: 30000,
    },
  ],
  execute: async (
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> => {
    // 权限检查
    if (!context.permissions.has("browser")) {
      return { success: false, error: "Permission denied: browser tool requires 'browser' permission" };
    }

    // 懒加载 playwright（可选依赖）
    let playwright: any;
    try {
      // @ts-ignore - playwright is an optional dependency loaded at runtime
      playwright = await import(/* webpackIgnore: true */ "playwright");
    } catch {
      return {
        success: false,
        error: "Playwright 未安装。请运行: bun add playwright",
      };
    }

    const action = params.action as string;
    const sessionId = params.session_id as string | undefined;
    const url = params.url as string | undefined;
    const selector = params.selector as string | undefined;
    const value = params.value as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;

    switch (action) {
      case "launch": {
        if (sessions.size >= MAX_BROWSER_SESSIONS) {
          return { success: false, error: `最多同时运行 ${MAX_BROWSER_SESSIONS} 个浏览器会话，请先关闭不需要的会话` };
        }
        if (url && isPrivateUrl(url)) {
          return { success: false, error: "安全限制：不允许访问内部网络地址" };
        }
        const browser = await playwright.chromium.launch({ headless: true });
        const page = await browser.newPage();
        if (url) {
          await page.goto(url, { timeout });
        }
        const newSessionId = crypto.randomUUID();
        sessions.set(newSessionId, {
          page,
          browser,
          lastAccess: Date.now(),
        });
        return {
          success: true,
          data: {
            session_id: newSessionId,
            url: url ?? "about:blank",
          },
          metadata: { action },
        };
      }

      case "navigate": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        if (!url) {
          return { success: false, error: "navigate 操作需要 url 参数" };
        }
        if (isPrivateUrl(url)) {
          return { success: false, error: "安全限制：不允许访问内部网络地址" };
        }
        await session.page.goto(url, { timeout });
        return {
          success: true,
          data: { url },
          metadata: { action },
        };
      }

      case "click": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        if (!selector) {
          return { success: false, error: "click 操作需要 selector 参数" };
        }
        await session.page.click(selector, { timeout });
        return {
          success: true,
          data: { selector },
          metadata: { action },
        };
      }

      case "fill": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        if (!selector) {
          return { success: false, error: "fill 操作需要 selector 参数" };
        }
        if (value === undefined) {
          return { success: false, error: "fill 操作需要 value 参数" };
        }
        await session.page.fill(selector, value, { timeout });
        return {
          success: true,
          data: { selector, value },
          metadata: { action },
        };
      }

      case "screenshot": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        const buffer = await session.page.screenshot({ type: "png" });
        const base64 = Buffer.from(buffer).toString("base64");
        return {
          success: true,
          data: {
            base64,
            mimeType: "image/png",
          },
          metadata: { action },
        };
      }

      case "get_text": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        let text: string;
        if (selector) {
          const element = await session.page.$(selector);
          if (!element) {
            return {
              success: false,
              error: `未找到元素: ${selector}`,
            };
          }
          text = await element.textContent();
        } else {
          text = await session.page.textContent("body");
        }
        return {
          success: true,
          data: { text: text ?? "" },
          metadata: { action, selector },
        };
      }

      case "evaluate": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        if (!value) {
          return {
            success: false,
            error: "evaluate 操作需要 value 参数（JavaScript 代码）",
          };
        }
        const result = await session.page.evaluate(value);
        return {
          success: true,
          data: { result },
          metadata: { action },
        };
      }

      case "close": {
        const session = getSession(sessionId);
        if (!session) {
          return { success: false, error: "无效的 session_id 或会话已过期" };
        }
        await session.browser.close();
        sessions.delete(sessionId!);
        return {
          success: true,
          data: { closed: sessionId },
          metadata: { action },
        };
      }

      default:
        return {
          success: false,
          error: `未知操作: ${action}。支持: launch, navigate, click, fill, screenshot, get_text, evaluate, close`,
        };
    }
  },
};
