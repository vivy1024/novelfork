/**
 * WebFetchTool - 网页内容抓取工具
 * 支持 readability（正文提取）、raw（原始 HTML）、text（纯文本）三种模式
 * readability 模式优先尝试 @mozilla/readability + jsdom，回退到简易正文提取
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";

/**
 * 简易正文提取（无需外部依赖）
 * 移除脚本/样式/导航等非正文元素，剥离 HTML 标签，折叠空白
 */
function extractReadableText(html: string): string {
  let text = html;

  // 移除 script、style、nav、header、footer、aside 标签及内容
  text = text.replace(
    /<(script|style|nav|header|footer|aside|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi,
    ""
  );

  // 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 将块级元素转为换行
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote|article|section)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // 剥离所有剩余 HTML 标签
  text = text.replace(/<[^>]*>/g, "");

  // 解码常见 HTML 实体
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 折叠连续空白（保留换行结构）
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  text = text.trim();

  return text;
}

/**
 * 纯文本提取：剥离所有 HTML 标签
 */
function stripHtmlTags(html: string): string {
  let text = html;
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

export const WebFetchTool: ToolDefinition = {
  name: "WebFetch",
  description: "抓取网页内容并提取正文",
  parameters: [
    {
      name: "url",
      type: "string",
      required: true,
      description: "要抓取的 URL",
    },
    {
      name: "mode",
      type: "string",
      required: false,
      description: "提取模式: readability（正文）| raw（原始 HTML）| text（纯文本）",
      default: "readability",
    },
    {
      name: "max_length",
      type: "number",
      required: false,
      description: "最大返回字符数（默认 20000）",
      default: 20000,
    },
  ],
  execute: async (
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> => {
    const url = params.url as string;
    const mode = (params.mode as string) ?? "readability";
    const maxLength = (params.max_length as number) ?? 20000;

    if (!url.trim()) {
      return { success: false, error: "URL 不能为空" };
    }

    // SSRF protection: block private/internal network addresses
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === "localhost" ||
        hostname.startsWith("127.") ||
        hostname.startsWith("169.254.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("172.16.") || hostname.startsWith("172.17.") || hostname.startsWith("172.18.") ||
        hostname.startsWith("172.19.") || hostname.startsWith("172.20.") || hostname.startsWith("172.21.") ||
        hostname.startsWith("172.22.") || hostname.startsWith("172.23.") || hostname.startsWith("172.24.") ||
        hostname.startsWith("172.25.") || hostname.startsWith("172.26.") || hostname.startsWith("172.27.") ||
        hostname.startsWith("172.28.") || hostname.startsWith("172.29.") || hostname.startsWith("172.30.") ||
        hostname.startsWith("172.31.") ||
        hostname === "[::1]" ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal")
      ) {
        return { success: false, error: "安全限制：不允许访问内部网络地址" };
      }
    } catch {
      return { success: false, error: `无效的 URL: ${url}` };
    }

    // 抓取页面
    let html: string;
    let contentType: string | null;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      contentType = response.headers.get("content-type");
      html = await response.text();
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return { success: false, error: `请求超时（30秒）: ${url}` };
      }
      return {
        success: false,
        error: `网络错误: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 提取标题
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]*>/g, "").trim()
      : "";

    let content: string;

    switch (mode) {
      case "readability": {
        // 尝试使用 @mozilla/readability + jsdom（可选依赖）
        try {
          // @ts-ignore - jsdom is an optional dependency loaded at runtime
          const { JSDOM } = await import(/* @vite-ignore */ /* webpackIgnore: true */ "jsdom" as string);
          // @ts-ignore - @mozilla/readability is an optional dependency loaded at runtime
          const { Readability } = await import(/* @vite-ignore */ /* webpackIgnore: true */ "@mozilla/readability" as string);
          const dom = new JSDOM(html, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();
          content = article?.textContent ?? extractReadableText(html);
        } catch {
          // 回退到简易提取
          content = extractReadableText(html);
        }
        break;
      }

      case "text": {
        content = stripHtmlTags(html);
        break;
      }

      case "raw": {
        content = html;
        break;
      }

      default:
        return {
          success: false,
          error: `未知模式: ${mode}。支持: readability, raw, text`,
        };
    }

    // 截断到最大长度
    const truncated = content.length > maxLength;
    if (truncated) {
      content = content.slice(0, maxLength);
    }

    return {
      success: true,
      data: {
        content,
        title,
        url,
        length: content.length,
        truncated,
      },
      metadata: {
        mode,
        contentType,
        originalLength: truncated ? content.length : undefined,
      },
    };
  },
};
