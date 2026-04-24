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
  /**
   * Optional pathname predicate. When present, overrides strict equality on
   * `path`, enabling routes like `/api/sessions/:id/chat` to match any
   * concrete session id. `path` remains the stable identifier used by
   * `socket.data.routePath` during dispatch.
   */
  matchPath?(pathname: string): boolean;
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

const NODE_SERVER_RESPONSE_STATE_WARNING = "Failed to find Response internal state key";
const DEFAULT_WARNING_RATE_LIMIT_MS = 5_000;

export type WarningSink = (...args: unknown[]) => void;

export function createRateLimitedWarningSink(
  sink: WarningSink,
  now: () => number = Date.now,
  windowMs = DEFAULT_WARNING_RATE_LIMIT_MS,
): WarningSink {
  let lastResponseStateWarningAt = Number.NEGATIVE_INFINITY;

  return (...args: unknown[]) => {
    const firstArg = typeof args[0] === "string" ? args[0] : "";
    if (firstArg.includes(NODE_SERVER_RESPONSE_STATE_WARNING)) {
      const currentTime = now();
      if (currentTime - lastResponseStateWarningAt < windowMs) {
        return;
      }
      lastResponseStateWarningAt = currentTime;
    }

    sink(...args);
  };
}

let nodeServerWarningFilterInstalled = false;

function installNodeServerWarningFilter(): void {
  if (nodeServerWarningFilterInstalled) {
    return;
  }

  nodeServerWarningFilterInstalled = true;
  console.warn = createRateLimitedWarningSink(console.warn.bind(console)) as typeof console.warn;
}

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
        const route = webSocketRoutes.find((candidate) =>
          candidate.matchPath ? candidate.matchPath(pathname) : candidate.path === pathname,
        );
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

  installNodeServerWarningFilter();
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
