/**
 * Chat routes — conversational interface for book operations.
 * SSE streaming for real-time AI responses.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { chatCompletion, createLLMClient } from "@actalk/inkos-core";
import type { RouterContext } from "./context.js";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function createChatRouter(ctx: RouterContext): Hono {
  const app = new Hono();
  const { state } = ctx;

  // In-memory message store (per book)
  const messageStore = new Map<string, Message[]>();

  // POST /api/chat/:bookId/send - Send message and get SSE stream
  app.post("/api/chat/:bookId/send", async (c) => {
    const bookId = c.req.param("bookId");
    const { content } = await c.req.json<{ content: string }>();

    if (!content?.trim()) {
      return c.json({ error: "Empty message" }, 400);
    }

    // Store user message
    const userMsg: Message = {
      id: `${Date.now()}-user`,
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    const messages = messageStore.get(bookId) || [];
    messages.push(userMsg);
    messageStore.set(bookId, messages);

    // Get session LLM config
    const sessionLlm = await ctx.getSessionLlm(c);
    const llmClient = createLLMClient(
      sessionLlm?.provider || "openai",
      sessionLlm?.apiKey || process.env.OPENAI_API_KEY || "",
      sessionLlm?.baseUrl || process.env.OPENAI_BASE_URL,
    );

    // Stream AI response
    return streamSSE(c, async (stream) => {
      let assistantContent = "";
      const assistantId = `${Date.now()}-assistant`;

      try {
        // Build context from book
        const book = await state.loadBookConfig(bookId);
        const systemPrompt = `You are a writing assistant for the novel "${book.title}".
Help the author with plot development, character analysis, and writing suggestions.
Be concise and actionable.`;

        // Convert messages to chat format
        const chatMessages = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Stream completion
        const completion = await chatCompletion(
          llmClient,
          [
            { role: "system", content: systemPrompt },
            ...chatMessages,
            { role: "user", content: content.trim() },
          ],
          sessionLlm?.model || "gpt-4o-mini",
          { stream: true },
        );

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content || "";
          if (delta) {
            assistantContent += delta;
            await stream.writeSSE({
              data: JSON.stringify({ type: "delta", content: delta }),
            });
          }
        }

        // Store assistant message
        const assistantMsg: Message = {
          id: assistantId,
          role: "assistant",
          content: assistantContent,
          timestamp: Date.now(),
        };
        messages.push(assistantMsg);
        messageStore.set(bookId, messages);

        await stream.writeSSE({
          data: JSON.stringify({ type: "done", messageId: assistantId }),
        });
      } catch (error) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      }
    });
  });

  // GET /api/chat/:bookId/messages - Get message history
  app.get("/api/chat/:bookId/messages", (c) => {
    const bookId = c.req.param("bookId");
    const messages = messageStore.get(bookId) || [];
    return c.json({ messages });
  });

  // DELETE /api/chat/:bookId/messages - Clear history
  app.delete("/api/chat/:bookId/messages", (c) => {
    const bookId = c.req.param("bookId");
    messageStore.delete(bookId);
    return c.json({ status: "cleared" });
  });

  return app;
}
