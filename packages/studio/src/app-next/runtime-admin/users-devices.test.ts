import { describe, expect, it, vi } from "vitest";
import { createDevicesClient } from "./devices";
import { createUsersClient } from "./users";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function expectRequest(
  fetchMock: ReturnType<typeof vi.fn>,
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

describe("users client", () => {
  it("covers the Runtime user, role, credentials, deletion, and registration contracts", async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/auth/me") return jsonResponse({ id: "me", username: "owner", role: "admin" });
      if (path === "/api/admin/users") return jsonResponse([]);
      if (path === "/api/settings") return jsonResponse({ auth: { registrationOpen: true } });
      if (path === "/api/admin/settings") return jsonResponse({ registrationOpen: false });
      if (path.includes("/users/")) return jsonResponse({ id: "user/a b", username: "writer", role: "admin" });
      return jsonResponse({ ok: true });
    });
    const client = createUsersClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    const snapshot = await client.getSnapshot();
    await client.updateRegistrationOpen(false);
    await client.updateUser("user/a b", { username: "writer", password: "new-secret", role: "admin", disabled: true });
    await client.deleteUser("user/a b");

    expect(snapshot).toEqual({
      currentUser: { id: "me", username: "owner", role: "admin" },
      users: [],
      registrationOpen: true,
    });
    expectRequest(fetchMock, 0, { path: "/api/auth/me" });
    expectRequest(fetchMock, 1, { path: "/api/admin/users" });
    expectRequest(fetchMock, 2, { path: "/api/settings" });
    expectRequest(fetchMock, 3, {
      path: "/api/admin/settings",
      method: "PATCH",
      body: { registrationOpen: false },
    });
    expectRequest(fetchMock, 4, {
      path: "/api/admin/users/user%2Fa%20b",
      method: "PATCH",
      body: { username: "writer", password: "new-secret", role: "admin", disabled: true },
    });
    expectRequest(fetchMock, 5, {
      path: "/api/admin/users/user%2Fa%20b",
      method: "DELETE",
    });
  });
});

describe("devices client", () => {
  it("covers list, create, token rotation, deletion, and real file transfer contracts", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = createDevicesClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const createInput = {
      name: "Windows workstation",
      description: "Writing PC",
      connectionMode: "reverse" as const,
      scope: "global" as const,
    };
    const transferInput = {
      direction: "download" as const,
      remotePath: "/books/chapter.md",
      localPath: "D:/backups/chapter.md",
      recursive: false,
    };

    await client.listDevices();
    await client.createDevice(createInput);
    await client.updateDevice("device/a b", { name: "Updated workstation", description: null });
    await client.rotateToken("device/a b");
    await client.transferFiles("device/a b", transferInput);
    await client.deleteDevice("device/a b");

    expectRequest(fetchMock, 0, { path: "/api/devices" });
    expectRequest(fetchMock, 1, { path: "/api/devices", method: "POST", body: createInput });
    expectRequest(fetchMock, 2, {
      path: "/api/devices/device%2Fa%20b",
      method: "PATCH",
      body: { name: "Updated workstation", description: null },
    });
    expectRequest(fetchMock, 3, {
      path: "/api/devices/device%2Fa%20b/rotate-token",
      method: "POST",
    });
    expectRequest(fetchMock, 4, {
      path: "/api/devices/device%2Fa%20b/transfers",
      method: "POST",
      body: transferInput,
    });
    expectRequest(fetchMock, 5, {
      path: "/api/devices/device%2Fa%20b",
      method: "DELETE",
    });
  });
});
