import { describe, expect, it, vi } from "vitest";
import { createRoutinesClient, createSettingsClient } from "./index";

function createFetchMock() {
  return vi.fn(async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function expectRequest(
  fetchMock: ReturnType<typeof createFetchMock>,
  index: number,
  expected: { path: string; method?: string; body?: unknown },
) {
  const [path, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  expect(path).toBe(expected.path);
  expect(init.method ?? "GET").toBe(expected.method ?? "GET");
  if ("body" in expected) {
    expect(JSON.parse(String(init.body))).toEqual(expected.body);
  } else {
    expect(init.body).toBeUndefined();
  }
}

describe("settings client", () => {
  it("uses Runtime settings routes and sends only the explicit partial patch", async () => {
    const fetchMock = createFetchMock();
    const client = createSettingsClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.get();
    await client.patch({ agent: { maxTurns: 42 } });
    await client.testModel({ model: "codex:gpt-5", prompt: "ping" });
    await client.generateTls();
    await client.addRetryRule({ domain: "api.example.com", statusCode: 429 });

    expectRequest(fetchMock, 0, { path: "/api/settings" });
    expectRequest(fetchMock, 1, {
      path: "/api/settings",
      method: "PATCH",
      body: { agent: { maxTurns: 42 } },
    });
    expectRequest(fetchMock, 2, {
      path: "/api/settings/test-model",
      method: "POST",
      body: { model: "codex:gpt-5", prompt: "ping" },
    });
    expectRequest(fetchMock, 3, { path: "/api/settings/generate-tls", method: "POST" });
    expectRequest(fetchMock, 4, {
      path: "/api/settings/retry-rules",
      method: "POST",
      body: { domain: "api.example.com", statusCode: 429 },
    });
  });

  it("covers project directory, complete TLS fields, masked passphrase round-trip, and update checks", async () => {
    const fetchMock = createFetchMock();
    const client = createSettingsClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.patch({
      paths: { defaultProjectDir: "D:/Novels" },
      server: {
        tls: {
          enabled: true,
          certFile: "D:/certs/runtime.pem",
          keyFile: "D:/certs/runtime-key.pem",
          caFile: "D:/certs/ca.pem",
          passphrase: "********",
        },
      },
    });
    await client.checkUpdate();

    expectRequest(fetchMock, 0, {
      path: "/api/settings",
      method: "PATCH",
      body: {
        paths: { defaultProjectDir: "D:/Novels" },
        server: {
          tls: {
            enabled: true,
            certFile: "D:/certs/runtime.pem",
            keyFile: "D:/certs/runtime-key.pem",
            caFile: "D:/certs/ca.pem",
            passphrase: "********",
          },
        },
      },
    });
    expectRequest(fetchMock, 1, { path: "/api/update/check" });
  });
});

describe("routines client", () => {
  it("encodes routine and project identifiers and covers prompt routes", async () => {
    const fetchMock = createFetchMock();
    const client = createRoutinesClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.listGlobal();
    await client.toggleGlobal("tool / terminal", true);
    await client.listProject("project/a b");
    await client.toggleProject("project/a b", "skill/中文", "reset");
    await client.getGlobalPrompt();
    await client.putGlobalPrompt("Be concise", "D:/Workspace/NovelFork/AGENT.md");

    expectRequest(fetchMock, 0, { path: "/api/routines" });
    expectRequest(fetchMock, 1, {
      path: "/api/routines/tool%20%2F%20terminal/toggle",
      method: "POST",
      body: { enabled: true },
    });
    expectRequest(fetchMock, 2, { path: "/api/routines/project/project%2Fa%20b" });
    expectRequest(fetchMock, 3, {
      path: "/api/routines/project/project%2Fa%20b/skill%2F%E4%B8%AD%E6%96%87/toggle",
      method: "POST",
      body: { action: "reset" },
    });
    expectRequest(fetchMock, 4, { path: "/api/routines/global-prompt" });
    expectRequest(fetchMock, 5, {
      path: "/api/routines/global-prompt",
      method: "PUT",
      body: { content: "Be concise", filePath: "D:/Workspace/NovelFork/AGENT.md" },
    });
  });
});
