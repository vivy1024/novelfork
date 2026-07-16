import { describe, expect, it, vi } from "vitest";
import {
  createAccountProfileClient,
  createCustomSubagentsClient,
  createHooksClient,
  createMcpClient,
  createNotificationSoundsClient,
  createSkillsClient,
  createUserPreferencesClient,
} from "./index";

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

describe("MCP client", () => {
  it("covers server lifecycle, import, testing, and tools", async () => {
    const fetchMock = createFetchMock();
    const client = createMcpClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const config = { name: "local mcp", transport: "stdio" as const, command: "node" };

    await client.list();
    await client.create(config);
    await client.patch("server/a b", {
      defaultBehavior: null,
      toolPermissionPatch: { toolName: "read/file", behavior: "readOnly" },
    });
    await client.delete("server/a b");
    await client.connect("server/a b");
    await client.disconnect("server/a b");
    await client.test(config);
    await client.import({ mcpServers: { demo: config } });
    await client.tools();

    expectRequest(fetchMock, 0, { path: "/api/mcp/servers" });
    expectRequest(fetchMock, 1, { path: "/api/mcp/servers", method: "POST", body: config });
    expectRequest(fetchMock, 2, {
      path: "/api/mcp/servers/server%2Fa%20b",
      method: "PATCH",
      body: {
        defaultBehavior: null,
        toolPermissionPatch: { toolName: "read/file", behavior: "readOnly" },
      },
    });
    expectRequest(fetchMock, 3, {
      path: "/api/mcp/servers/server%2Fa%20b",
      method: "DELETE",
    });
    expectRequest(fetchMock, 4, {
      path: "/api/mcp/servers/server%2Fa%20b/connect",
      method: "POST",
    });
    expectRequest(fetchMock, 5, {
      path: "/api/mcp/servers/server%2Fa%20b/disconnect",
      method: "POST",
    });
    expectRequest(fetchMock, 6, {
      path: "/api/mcp/servers/test",
      method: "POST",
      body: config,
    });
    expectRequest(fetchMock, 7, {
      path: "/api/mcp/servers/import",
      method: "POST",
      body: { json: { mcpServers: { demo: config } } },
    });
    expectRequest(fetchMock, 8, { path: "/api/mcp/tools" });
  });
});

describe("skills client", () => {
  it("covers global and project CRUD, toggle, file read, and query encoding", async () => {
    const fetchMock = createFetchMock();
    const client = createSkillsClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const input = { name: "review", description: "Review code", content: "Instructions" };

    await client.listGlobal();
    await client.getGlobal("review / 中文");
    await client.createGlobal(input);
    await client.updateGlobal("old/name", input);
    await client.deleteGlobal("old/name");
    await client.toggleGlobal("old/name", false);
    await client.listProject("project / 中文");
    await client.getProject("project / 中文", "skill/name");
    await client.createProject("project / 中文", input);
    await client.updateProject("project / 中文", "skill/name", input);
    await client.deleteProject("project / 中文", "skill/name");
    await client.readProjectFile("project / 中文", "skill/name", "refs/a b.md");

    expectRequest(fetchMock, 0, { path: "/api/skills/global" });
    expectRequest(fetchMock, 1, { path: "/api/skills/global/review%20%2F%20%E4%B8%AD%E6%96%87" });
    expectRequest(fetchMock, 2, { path: "/api/skills/global", method: "POST", body: input });
    expectRequest(fetchMock, 3, {
      path: "/api/skills/global/old%2Fname",
      method: "PUT",
      body: input,
    });
    expectRequest(fetchMock, 4, { path: "/api/skills/global/old%2Fname", method: "DELETE" });
    expectRequest(fetchMock, 5, {
      path: "/api/skills/global/old%2Fname/toggle",
      method: "POST",
      body: { enabled: false },
    });
    expectRequest(fetchMock, 6, { path: "/api/skills?projectId=project+%2F+%E4%B8%AD%E6%96%87" });
    expectRequest(fetchMock, 7, {
      path: "/api/skills/skill%2Fname?projectId=project+%2F+%E4%B8%AD%E6%96%87",
    });
    expectRequest(fetchMock, 8, {
      path: "/api/skills?projectId=project+%2F+%E4%B8%AD%E6%96%87",
      method: "POST",
      body: input,
    });
    expectRequest(fetchMock, 9, {
      path: "/api/skills/skill%2Fname?projectId=project+%2F+%E4%B8%AD%E6%96%87",
      method: "PUT",
      body: input,
    });
    expectRequest(fetchMock, 10, {
      path: "/api/skills/skill%2Fname?projectId=project+%2F+%E4%B8%AD%E6%96%87",
      method: "DELETE",
    });
    expectRequest(fetchMock, 11, {
      path: "/api/skills/skill%2Fname/files/refs/a%20b.md?projectId=project+%2F+%E4%B8%AD%E6%96%87",
    });
  });
});

describe("preferences, profile, and notification sound clients", () => {
  it("uses explicit appearance and notification preference patches", async () => {
    const fetchMock = createFetchMock();
    const client = createUserPreferencesClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.get();
    await client.patch({
      language: "zh-CN",
      terminalTheme: "dark",
      notifySoundEnabled: true,
      notifySoundType: "custom",
      notifySoundFileId: "sound/a b",
    });

    expectRequest(fetchMock, 0, { path: "/api/user-preferences" });
    expectRequest(fetchMock, 1, {
      path: "/api/user-preferences",
      method: "PATCH",
      body: {
        language: "zh-CN",
        terminalTheme: "dark",
        notifySoundEnabled: true,
        notifySoundType: "custom",
        notifySoundFileId: "sound/a b",
      },
    });
  });

  it("exposes account profile data while restricting patches to Git identity", async () => {
    const fetchMock = createFetchMock();
    const client = createAccountProfileClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.get();
    await client.patch({ gitUsername: "Novel Author", gitEmail: "author@example.com" });

    expectRequest(fetchMock, 0, { path: "/api/auth/me" });
    expectRequest(fetchMock, 1, {
      path: "/api/auth/me",
      method: "PATCH",
      body: { gitUsername: "Novel Author", gitEmail: "author@example.com" },
    });
  });

  it("uploads FormData through fetchJson and encodes notification sound deletion IDs", async () => {
    const fetchMock = createFetchMock();
    const client = createNotificationSoundsClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const file = new File(["audio"], "alert tone.mp3", { type: "audio/mpeg" });

    await client.upload(file);
    await client.delete("sound/a b");

    const [uploadPath, uploadInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(uploadPath).toBe("/api/notification-sounds");
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.body).toBeInstanceOf(FormData);
    const uploadedFile = (uploadInit.body as FormData).get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).name).toBe("alert tone.mp3");

    expectRequest(fetchMock, 1, {
      path: "/api/notification-sounds/sound%2Fa%20b",
      method: "DELETE",
    });
  });
});

describe("custom subagents and hooks clients", () => {
  it("covers custom subagent CRUD with encoded names", async () => {
    const fetchMock = createFetchMock();
    const client = createCustomSubagentsClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const input = {
      name: "reviewer",
      description: "Reviews changes",
      toolAccess: "custom" as const,
      customTools: ["Read", "Grep"],
      defaultModel: "",
      prompt: "Review carefully",
    };

    await client.list();
    await client.get("review / 中文");
    await client.create(input);
    await client.update("review / 中文", input);
    await client.delete("review / 中文");

    expectRequest(fetchMock, 0, { path: "/api/custom-subagents" });
    expectRequest(fetchMock, 1, { path: "/api/custom-subagents/review%20%2F%20%E4%B8%AD%E6%96%87" });
    expectRequest(fetchMock, 2, { path: "/api/custom-subagents", method: "POST", body: input });
    expectRequest(fetchMock, 3, {
      path: "/api/custom-subagents/review%20%2F%20%E4%B8%AD%E6%96%87",
      method: "PUT",
      body: input,
    });
    expectRequest(fetchMock, 4, {
      path: "/api/custom-subagents/review%20%2F%20%E4%B8%AD%E6%96%87",
      method: "DELETE",
    });
  });

  it("covers global/project/all hook lists and CRUD", async () => {
    const fetchMock = createFetchMock();
    const client = createHooksClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const input = {
      projectId: "project/a b",
      event: "PreToolUse" as const,
      type: "command" as const,
      command: "exit 0",
    };

    await client.list("project/a b");
    await client.listGlobal();
    await client.listAll();
    await client.get("hook/a b");
    await client.create(input);
    await client.update("hook/a b", { event: "AttentionResolved", enabled: false });
    await client.delete("hook/a b");

    expectRequest(fetchMock, 0, { path: "/api/hooks?projectId=project%2Fa+b" });
    expectRequest(fetchMock, 1, { path: "/api/hooks" });
    expectRequest(fetchMock, 2, { path: "/api/hooks/all" });
    expectRequest(fetchMock, 3, { path: "/api/hooks/hook%2Fa%20b" });
    expectRequest(fetchMock, 4, { path: "/api/hooks", method: "POST", body: input });
    expectRequest(fetchMock, 5, {
      path: "/api/hooks/hook%2Fa%20b",
      method: "PUT",
      body: { event: "AttentionResolved", enabled: false },
    });
    expectRequest(fetchMock, 6, { path: "/api/hooks/hook%2Fa%20b", method: "DELETE" });
  });
});
