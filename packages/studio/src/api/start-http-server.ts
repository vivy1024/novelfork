type FetchHandler = (request: Request) => Response | Promise<Response>;

function getBunRuntime(): { serve?: (options: { fetch: FetchHandler; port: number }) => unknown } | undefined {
  const runtime = globalThis as typeof globalThis & {
    readonly Bun?: { serve?: (options: { fetch: FetchHandler; port: number }) => unknown };
  };
  return runtime.Bun;
}

export async function startHttpServer(options: {
  readonly fetch: FetchHandler;
  readonly port: number;
}): Promise<void> {
  const bunRuntime = getBunRuntime();
  if (typeof bunRuntime?.serve === "function") {
    bunRuntime.serve({ fetch: options.fetch, port: options.port });
    return;
  }

  const { serve } = await import("@hono/node-server");
  serve({ fetch: options.fetch, port: options.port });
}
