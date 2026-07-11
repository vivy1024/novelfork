import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createProviderAdapterRegistry } from "./index.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

describe("Task17 real Anthropic-compatible HTTP integration", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  });

  it("sends ordered, cache-correct, non-duplicated system hints through the real fetch path", async () => {
    const requests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requests.push({
          url: request.url ?? "",
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          id: "msg_local",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "local-ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 7, output_tokens: 2 },
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;

    const result = await createProviderAdapterRegistry().get("anthropic-compatible").generate({
      providerId: "anthropic-local",
      providerName: "Anthropic Local",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "local-test-key",
      modelId: "claude-local",
      messages: [
        { role: "system", content: "主静态提示\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n主动态提示" },
        { role: "system", content: "runtime hint one" },
        { role: "system", content: "runtime hint two" },
        { role: "user", content: "继续" },
      ],
    });

    expect(result).toMatchObject({ success: true, type: "message", content: "local-ok", stopReason: "end_turn" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/v1/messages");
    expect(requests[0].headers["x-api-key"]).toBe("local-test-key");
    expect(requests[0].body.system).toEqual([
      { type: "text", text: "主静态提示", cache_control: { type: "ephemeral" } },
      { type: "text", text: "主动态提示" },
      { type: "text", text: "runtime hint one" },
      { type: "text", text: "runtime hint two" },
    ]);
    expect(requests[0].body.messages).toEqual([{ role: "user", content: "继续" }]);
    const serialized = JSON.stringify(requests[0].body);
    for (const hint of ["主静态提示", "主动态提示", "runtime hint one", "runtime hint two"]) {
      expect(serialized.split(hint)).toHaveLength(2);
    }
  });
});
