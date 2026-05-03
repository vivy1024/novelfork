import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderAdapterRegistry, type RuntimeAdapter } from "../lib/provider-adapters";
import { ProviderRuntimeStore } from "../lib/provider-runtime-store";
import { createAggregationsRouter } from "./aggregations";

// Mock user-config-service to use in-memory storage
import type { ModelAggregation, UserConfig } from "../../types/settings";
import { DEFAULT_USER_CONFIG } from "../../types/settings";

let mockConfig: UserConfig;

vi.mock("../lib/user-config-service", () => ({
  loadUserConfig: vi.fn(async () => mockConfig),
  updateUserConfig: vi.fn(async (patch: { modelDefaults?: { aggregations?: ModelAggregation[] } }) => {
    if (patch.modelDefaults?.aggregations) {
      mockConfig = {
        ...mockConfig,
        modelDefaults: {
          ...mockConfig.modelDefaults,
          aggregations: patch.modelDefaults.aggregations,
        },
      };
    }
    return mockConfig;
  }),
}));

describe("aggregations route CRUD", () => {
  let app: ReturnType<typeof createAggregationsRouter>;

  beforeEach(() => {
    mockConfig = {
      ...DEFAULT_USER_CONFIG,
      modelDefaults: {
        ...DEFAULT_USER_CONFIG.modelDefaults,
        aggregations: [],
      },
    };
    app = createAggregationsRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists empty aggregations", async () => {
    const response = await app.request("http://localhost/");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.aggregations).toEqual([]);
  });

  it("creates an aggregation with auto-generated id", async () => {
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "DeepSeek V4 Flash",
        members: [
          { providerId: "sub2api", modelId: "deepseek-v4-flash", priority: 1 },
          { providerId: "openrouter", modelId: "deepseek-v4-flash", priority: 2 },
        ],
        routingStrategy: "priority",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.aggregation).toMatchObject({
      displayName: "DeepSeek V4 Flash",
      routingStrategy: "priority",
      members: [
        { providerId: "sub2api", modelId: "deepseek-v4-flash", priority: 1 },
        { providerId: "openrouter", modelId: "deepseek-v4-flash", priority: 2 },
      ],
    });
    expect(body.aggregation.id).toMatch(/^agg:/);
  });

  it("creates an aggregation with explicit id", async () => {
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "agg:ds-v4",
        displayName: "DeepSeek V4",
        members: [{ providerId: "sub2api", modelId: "deepseek-v4", priority: 1 }],
        routingStrategy: "round-robin",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.aggregation.id).toBe("agg:ds-v4");
  });

  it("rejects duplicate aggregation id", async () => {
    const payload = {
      id: "agg:dup",
      displayName: "Dup",
      members: [{ providerId: "a", modelId: "b", priority: 1 }],
      routingStrategy: "priority",
    };

    await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(409);
  });

  it("rejects creation with missing fields", async () => {
    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "No members" }),
    });

    expect(response.status).toBe(400);
  });

  it("updates an aggregation", async () => {
    await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "agg:update-test",
        displayName: "Original",
        members: [{ providerId: "a", modelId: "b", priority: 1 }],
        routingStrategy: "priority",
      }),
    });

    const response = await app.request("http://localhost/agg:update-test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Updated",
        routingStrategy: "random",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.aggregation).toMatchObject({
      id: "agg:update-test",
      displayName: "Updated",
      routingStrategy: "random",
    });
  });

  it("returns 404 when updating non-existent aggregation", async () => {
    const response = await app.request("http://localhost/agg:nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "X" }),
    });

    expect(response.status).toBe(404);
  });

  it("deletes an aggregation", async () => {
    await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "agg:delete-test",
        displayName: "To Delete",
        members: [{ providerId: "a", modelId: "b", priority: 1 }],
        routingStrategy: "priority",
      }),
    });

    const deleteResponse = await app.request("http://localhost/agg:delete-test", { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);

    const listResponse = await app.request("http://localhost/");
    const body = await listResponse.json();
    expect(body.aggregations).toEqual([]);
  });

  it("returns 404 when deleting non-existent aggregation", async () => {
    const response = await app.request("http://localhost/agg:nonexistent", { method: "DELETE" });
    expect(response.status).toBe(404);
  });
});
