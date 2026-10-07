import { describe, expect, it, vi } from "vitest";
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

  it("falls back to the product force-delete when the Runtime delete fails with a 500", async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && !path.includes("/force")) {
        return new Response(JSON.stringify({ error: "fk constraint" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return jsonResponse({ ok: true });
    });
    const client = createUsersClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.deleteUser("user/with-data");

    expectRequest(fetchMock, 0, { path: "/api/admin/users/user%2Fwith-data", method: "DELETE" });
    expectRequest(fetchMock, 1, { path: "/api/product/admin/users/user%2Fwith-data/force", method: "DELETE" });
  });

  it("does not fall back when the Runtime delete fails with a non-500 error", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createUsersClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.deleteUser("user/no-data")).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
