/**
 * Chat routes — conversational interface for book operations.
 */

import { Hono } from "hono";
import { chatCompletion } from "@actalk/novelfork-core";
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

  // POST /api/chat/:bookId/send - Send message and get response
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

    try {
      // Get session LLM config and build pipeline config
      const sessionLlm = await ctx.getSessionLlm(c);
      const config = await ctx.buildPipelineConfig(sessionLlm);

      // Build context from book
      const book = await state.loadBookConfig(bookId);
      const systemPrompt = `You are a writing assistant for the novel "${book.title}".
Help the author with plot development, character analysis, and writing suggestions.
Be concise and actionable.`;

      // Convert messages to chat format
      const chatMessages = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Call completion
      const response = await chatCompletion(
        config.client,
        config.model,
        [
          { role: "system", content: systemPrompt },
          ...chatMessages,
          { role: "user", content: content.trim() },
        ],
      );

      // Store assistant message
      const assistantMsg: Message = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: response.content,
        timestamp: Date.now(),
      };
      messages.push(assistantMsg);
      messageStore.set(bookId, messages);

      return c.json({ message: assistantMsg });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
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
