import type { ServerType } from "@hono/node-server";

import { createAdaptorServer } from "@hono/node-server";
import {
  attachSessionChatTransport,
  detachSessionChatTransport,
  handleSessionChatTransportMessage,
} from "./lib/session-chat-service.js";

type FetchHandler = (request: Request) => Response | Promise<Response>;

function getBunRuntime(): { serve?: (options: unknown) => unknown } | undefined {
  const runtime = globalThis as typeof globalThis & {
    readonly Bun?: { serve?: (options: unknown) => unknown };
  };
  return runtime.Bun;
}

export async function startHttpServer(options: {
  readonly fetch: FetchHandler;
  readonly port: number;
  readonly configureServer?: (server: ServerType) => void;
}): Promise<void> {
  const bunRuntime = getBunRuntime();
  if (typeof bunRuntime?.serve === "function") {
    const bunServer = bunRuntime.serve({
      fetch: async (request: Request, server: any) => {
        const url = new URL(request.url);
        const sessionChatMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/chat$/);
        const isWebSocketUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";

        if (sessionChatMatch && isWebSocketUpgrade) {
          const sessionId = decodeURIComponent(sessionChatMatch[1]!);
          if (server?.upgrade?.(request, { data: { sessionId } })) {
            return new Response(null);
          }
        }

        return options.fetch(request);
      },
      websocket: {
        async open(ws: any) {
          if (ws?.data?.sessionId) {
            await attachSessionChatTransport(ws.data.sessionId, ws);
          }
        },
        async message(ws: any, message: string | { buffer: ArrayBufferLike }) {
          if (ws?.data?.sessionId) {
            const payload = typeof message === "string" ? message : new Uint8Array(message.buffer);
            await handleSessionChatTransportMessage(ws.data.sessionId, ws, payload);
          }
        },
        close(ws: any) {
          if (ws?.data?.sessionId) {
            detachSessionChatTransport(ws.data.sessionId, ws);
          }
        },
      },
      port: options.port,
    });

    void bunServer;
    return;
  }

  const server = createAdaptorServer({ fetch: options.fetch });
  options.configureServer?.(server);
  server.listen(options.port);
}
