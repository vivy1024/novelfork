import { startHttpServer } from "../../start-http-server.js";
import { ProviderRuntimeStore } from "../provider-runtime-store.js";
import { createSession } from "../session-service.js";
import { setupSessionChatWebSocket } from "../session-chat-service.js";

const port = Number(process.env.TASK17_WS_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("TASK17_WS_PORT is required");

let activeRequests = 0;
let maxActiveRequests = 0;
const requestContents: string[] = [];
const serializedRequests: string[] = [];

function extractLastUserContent(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((message) => {
    return typeof message === "object" && message !== null && (message as { role?: unknown }).role === "user";
  }) as { content?: unknown } | undefined;
  return typeof lastUser?.content === "string" ? lastUser.content : "";
}

async function waitForAbortOrDelay(request: Request, delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    request.signal.addEventListener("abort", finish, { once: true });
    if (request.signal.aborted) finish();
  });
}

const server = await startHttpServer({
  port,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/task17-session") {
      return Response.json({ sessionId: session.id });
    }
    if (url.pathname === "/task17-metrics") {
      return Response.json({
        activeRequests,
        maxActiveRequests,
        requestContents,
        serializedRequests,
      });
    }
    if (url.pathname !== "/v1/messages" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const body = await request.json() as Record<string, unknown>;
    serializedRequests.push(JSON.stringify(body));
    requestContents.push(extractLastUserContent(body));
    const requestIndex = requestContents.length - 1;
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    try {
      await waitForAbortOrDelay(request, requestIndex === 0 ? 5_000 : 10);
      if (request.signal.aborted) return new Response("aborted", { status: 499 });
      const content = `reply-${requestContents[requestIndex]}`;
      const events = [
        { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: content } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      });
    } finally {
      activeRequests -= 1;
    }
  },
});
if (!server || !("registerWebSocketRoute" in server)) {
  throw new Error("Task17 fixture requires Bun WebSocket runtime");
}
setupSessionChatWebSocket(server);

const providerStore = new ProviderRuntimeStore();
await providerStore.createProvider({
  id: "task17-anthropic",
  name: "Task17 Anthropic",
  type: "custom",
  enabled: true,
  priority: 1,
  apiKeyRequired: true,
  baseUrl: `http://127.0.0.1:${port}/v1`,
  compatibility: "anthropic-compatible",
  config: { apiKey: "task17-local-key" },
  models: [{
    id: "claude-task17",
    name: "Claude Task17",
    contextWindow: 32_000,
    maxOutputTokens: 1_024,
    source: "detected",
  }],
});

const session = await createSession({
  title: "Task17 production WebSocket",
  agentId: "writer",
  sessionMode: "chat",
  sessionConfig: {
    permissionMode: "allow",
    providerId: "task17-anthropic",
    modelId: "claude-task17",
  },
});

console.log(`TASK17_WS_READY:${port}:${session.id}`);

const close = async () => {
  await server.close();
  process.exit(0);
};
process.once("SIGTERM", () => { void close(); });
process.once("SIGINT", () => { void close(); });
