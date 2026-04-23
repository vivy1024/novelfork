import type { Server } from "node:http";

type FetchHandler = (request: Request) => Response | Promise<Response>;

type BunFetchHandler = (request: Request, server: BunUpgradeServer) => Response | Promise<Response> | undefined;

export interface BunUpgradeServer {
  upgrade(request: Request, options?: { data?: Record<string, unknown> }): boolean;
}

export interface BunWebSocketConnection {
  readonly data?: Record<string, unknown>;
  send(payload: string): number | void;
  close(code?: number, reason?: string): void;
}

export interface BunWebSocketRoute {
  readonly path: string;
  upgrade(request: Request, server: BunUpgradeServer): boolean;
  open?(socket: BunWebSocketConnection): void;
  close?(socket: BunWebSocketConnection, code: number, reason: string): void;
  error?(socket: BunWebSocketConnection, error: Error): void;
  message?(socket: BunWebSocketConnection, message: string | Uint8Array): void;
}

export interface BunWebSocketRegistrar {
  readonly runtime: "bun";
  registerWebSocketRoute(route: BunWebSocketRoute): void;
}

export type StartedHttpServer = Server | BunWebSocketRegistrar;

function getBunRuntime():
  | {
      serve?: (options: {
        fetch: BunFetchHandler;
        port: number;
        websocket?: {
          open?(socket: BunWebSocketConnection): void;
          close?(socket: BunWebSocketConnection, code: number, reason: string): void;
          error?(socket: BunWebSocketConnection, error: Error): void;
          message?(socket: BunWebSocketConnection, message: string | Uint8Array): void;
        };
      }) => unknown;
    }
  | undefined {
  const runtime = globalThis as typeof globalThis & {
    readonly Bun?: {
      serve?: (options: {
        fetch: BunFetchHandler;
        port: number;
        websocket?: {
          open?(socket: BunWebSocketConnection): void;
          close?(socket: BunWebSocketConnection, code: number, reason: string): void;
          error?(socket: BunWebSocketConnection, error: Error): void;
          message?(socket: BunWebSocketConnection, message: string | Uint8Array): void;
        };
      }) => unknown;
    };
  };
  return runtime.Bun;
}

export async function startHttpServer(options: {
  readonly fetch: FetchHandler;
  readonly port: number;
}): Promise<StartedHttpServer> {
  const bunRuntime = getBunRuntime();
  if (typeof bunRuntime?.serve === "function") {
    const webSocketRoutes: BunWebSocketRoute[] = [];

    bunRuntime.serve({
      port: options.port,
      fetch(request, server) {
        const pathname = new URL(request.url).pathname;
        const route = webSocketRoutes.find((candidate) => candidate.path === pathname);
        if (route && route.upgrade(request, server)) {
          return undefined;
        }
        return options.fetch(request);
      },
      websocket: {
        open(socket) {
          resolveWebSocketRoute(webSocketRoutes, socket)?.open?.(socket);
        },
        close(socket, code, reason) {
          resolveWebSocketRoute(webSocketRoutes, socket)?.close?.(socket, code, reason);
        },
        error(socket, error) {
          resolveWebSocketRoute(webSocketRoutes, socket)?.error?.(socket, error);
        },
        message(socket, message) {
          resolveWebSocketRoute(webSocketRoutes, socket)?.message?.(socket, message);
        },
      },
    });

    return {
      runtime: "bun",
      registerWebSocketRoute(route) {
        const existingIndex = webSocketRoutes.findIndex((candidate) => candidate.path === route.path);
        if (existingIndex >= 0) {
          webSocketRoutes.splice(existingIndex, 1, route);
          return;
        }
        webSocketRoutes.push(route);
      },
    };
  }

  const { serve } = await import("@hono/node-server");
  return serve({ fetch: options.fetch, port: options.port }) as Server;
}

function resolveWebSocketRoute(routes: BunWebSocketRoute[], socket: BunWebSocketConnection) {
  const routePath = typeof socket.data?.routePath === "string" ? socket.data.routePath : null;
  if (!routePath) {
    return null;
  }
  return routes.find((route) => route.path === routePath) ?? null;
}
