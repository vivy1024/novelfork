/**
 * WebSearchTool - 互联网搜索工具
 * 优先使用 Serper API（需 SERPER_API_KEY），回退到 DuckDuckGo HTML 搜索
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../tool-executor.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 通过 Serper API 搜索
 */
async function searchWithSerper(
  query: string,
  numResults: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: numResults }),
  });

  if (!response.ok) {
    throw new Error(`Serper API 错误: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  const organic = data.organic ?? [];

  return organic.slice(0, numResults).map((item: any) => ({
    title: item.title ?? "",
    url: item.link ?? "",
    snippet: item.snippet ?? "",
  }));
}

/**
 * 通过 DuckDuckGo HTML 搜索（无需 API Key）
 */
async function searchWithDuckDuckGo(
  query: string,
  numResults: number
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo 请求失败: ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // 解析 DuckDuckGo HTML 结果
  // 结果块格式: <a class="result__a" href="...">title</a>
  //             <a class="result__snippet">snippet</a>
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < numResults; i++) {
    const block = resultBlocks[i];

    // 提取 URL 和标题
    const linkMatch = block.match(
      /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1];
    const titleHtml = linkMatch[2];

    // DuckDuckGo 使用重定向 URL，提取实际 URL
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      resultUrl = decodeURIComponent(uddgMatch[1]);
    }

    // 清理标题中的 HTML 标签
    const title = titleHtml.replace(/<[^>]*>/g, "").trim();

    // 提取摘要
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
    );
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, "").trim()
      : "";

    if (title && resultUrl) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return results;
}

export const WebSearchTool: ToolDefinition = {
  name: "WebSearch",
  description: "搜索互联网获取最新信息",
  parameters: [
    {
      name: "query",
      type: "string",
      required: true,
      description: "搜索关键词",
    },
    {
      name: "num_results",
      type: "number",
      required: false,
      description: "返回结果数量（默认 5）",
      default: 5,
    },
  ],
  execute: async (
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> => {
    const query = params.query as string;
    const numResults = (params.num_results as number) ?? 5;

    if (!query.trim()) {
      return { success: false, error: "搜索关键词不能为空" };
    }

    let results: SearchResult[];
    let source: string;

    // 优先使用 Serper API
    const serperKey = process.env.SERPER_API_KEY;
    if (serperKey) {
      try {
        results = await searchWithSerper(query, numResults, serperKey);
        source = "serper";
      } catch (err) {
        // Serper 失败，回退到 DuckDuckGo
        try {
          results = await searchWithDuckDuckGo(query, numResults);
          source = "duckduckgo";
        } catch (ddgErr) {
          return {
            success: false,
            error: `搜索失败。Serper: ${err instanceof Error ? err.message : String(err)}; DuckDuckGo: ${ddgErr instanceof Error ? ddgErr.message : String(ddgErr)}`,
          };
        }
      }
    } else {
      // 无 Serper Key，直接用 DuckDuckGo
      try {
        results = await searchWithDuckDuckGo(query, numResults);
        source = "duckduckgo";
      } catch (err) {
        return {
          success: false,
          error: `搜索失败: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return {
      success: true,
      data: { results, total: results.length },
      metadata: { query, source, numResults },
    };
  },
};
