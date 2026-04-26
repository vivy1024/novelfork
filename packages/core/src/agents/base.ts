import type { LLMClient, LLMMessage, LLMResponse, OnStreamProgress } from "../llm/provider.js";
import { chatCompletion } from "../llm/provider.js";
import { searchWeb, fetchUrl } from "../utils/web-search.js";
import type { Logger } from "../utils/logger.js";

function summarizeError(error: unknown, maxLength = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}

export interface AgentContext {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly bookId?: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
}

export abstract class BaseAgent {
  protected readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  protected get log() {
    return this.ctx.logger;
  }

  protected async chat(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    const startedAt = Date.now();
    try {
      const response = await chatCompletion(this.ctx.client, this.ctx.model, messages, {
        ...options,
        onStreamProgress: this.ctx.onStreamProgress,
      });
      this.log?.info("AI request completed", {
        eventType: "ai.request",
        requestDomain: "ai",
        endpoint: `llm://agent/${this.name}`,
        method: "LLM",
        requestKind: "agent-chat",
        narrator: this.name,
        provider: this.ctx.client.provider,
        model: this.ctx.model,
        bookId: this.ctx.bookId,
        durationMs: Date.now() - startedAt,
        status: "success",
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        tokenSource: "actual",
      });
      return response;
    } catch (error) {
      this.log?.error("AI request failed", {
        eventType: "ai.request",
        requestDomain: "ai",
        endpoint: `llm://agent/${this.name}`,
        method: "LLM",
        requestKind: "agent-chat",
        narrator: this.name,
        provider: this.ctx.client.provider,
        model: this.ctx.model,
        bookId: this.ctx.bookId,
        durationMs: Date.now() - startedAt,
        status: "error",
        errorSummary: summarizeError(error),
      });
      throw error;
    }
  }

  /**
   * Chat with web search enabled.
   * OpenAI: uses native web_search_options / web_search_preview.
   * Other providers: searches via Tavily API (TAVILY_API_KEY), injects results into prompt.
   */
  protected async chatWithSearch(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    // OpenAI has native search — use it directly
    if (this.ctx.client.provider === "openai") {
      const startedAt = Date.now();
      try {
        const response = await chatCompletion(this.ctx.client, this.ctx.model, messages, {
          ...options,
          webSearch: true,
          onStreamProgress: this.ctx.onStreamProgress,
        });
        this.log?.info("AI request completed", {
          eventType: "ai.request",
          requestDomain: "ai",
          endpoint: `llm://agent/${this.name}/search`,
          method: "LLM",
          requestKind: "agent-search",
          narrator: this.name,
          provider: this.ctx.client.provider,
          model: this.ctx.model,
          bookId: this.ctx.bookId,
          durationMs: Date.now() - startedAt,
          status: "success",
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          tokenSource: "actual",
        });
        return response;
      } catch (error) {
        this.log?.error("AI request failed", {
          eventType: "ai.request",
          requestDomain: "ai",
          endpoint: `llm://agent/${this.name}/search`,
          method: "LLM",
          requestKind: "agent-search",
          narrator: this.name,
          provider: this.ctx.client.provider,
          model: this.ctx.model,
          bookId: this.ctx.bookId,
          durationMs: Date.now() - startedAt,
          status: "error",
          errorSummary: summarizeError(error),
        });
        throw error;
      }
    }

    // Other providers: self-hosted search → inject results into prompt
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return this.chat(messages, options);
    }

    try {
      // Extract search query from user message (first 200 chars)
      const query = lastUserMsg.content.slice(0, 200);
      this.log?.info(`[search] Searching: ${query.slice(0, 60)}...`);

      const results = await searchWeb(query, 3);
      if (results.length === 0) {
        this.log?.warn("[search] No results found, falling back to regular chat");
        return this.chat(messages, options);
      }

      // Fetch top result for full content
      let fullContent = "";
      try {
        fullContent = await fetchUrl(results[0]!.url, 4000);
      } catch {
        // Fetch failed, use snippets only
      }

      const searchContext = [
        "## Web Search Results\n",
        ...results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`),
        ...(fullContent ? [`\n## Full Content (Top Result)\n${fullContent}`] : []),
      ].join("\n");

      // Inject search results before the last user message
      const augmentedMessages: LLMMessage[] = messages.map((m) =>
        m === lastUserMsg
          ? { ...m, content: `${searchContext}\n\n---\n\n${m.content}` }
          : m,
      );

      return this.chat(augmentedMessages, options);
    } catch (e) {
      this.log?.warn(`[search] Search failed: ${e}, falling back to regular chat`);
      return this.chat(messages, options);
    }
  }

  abstract get name(): string;
}
