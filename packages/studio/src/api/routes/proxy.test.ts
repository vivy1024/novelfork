import { describe, expect, it, vi, beforeEach } from "vitest";
import { createProxyRouter } from "./proxy";

// Mock user-config-service
vi.mock("../lib/user-config-service", () => {
  let mockConfig = {
    proxy: {
      providers: {} as Record<string, string>,
      webFetch: "",
      platforms: {} as Record<string, string>,
    },
  };

  return {
    loadUserConfig: vi.fn(async () => ({
      ...mockConfig,
      proxy: {
        ...mockConfig.proxy,
        providers: { ...mockConfig.proxy.providers },
        platforms: { ...mockConfig.proxy.platforms },
      },
    })),
    updateUserConfig: vi.fn(async (patch: { proxy?: Partial<typeof mockConfig.proxy> }) => {
      if (patch.proxy) {
        const newProviders = patch.proxy.providers != null
          ? { ...patch.proxy.providers }
          : { ...mockConfig.proxy.providers };
        const newPlatforms = patch.proxy.platforms != null
          ? { ...patch.proxy.platforms }
          : { ...mockConfig.proxy.platforms };
        mockConfig = {
          ...mockConfig,
          proxy: {
            providers: newProviders,
            webFetch: typeof patch.proxy.webFetch === "string" ? patch.proxy.webFetch : mockConfig.proxy.webFetch,
            platforms: newPlatforms,
          },
        };
      }
      return mockConfig;
    }),
    __resetMockConfig: () => {
      mockConfig = {
        proxy: {
          providers: {},
          webFetch: "",
          platforms: {},
        },
      };
    },
  };
});

// Access the reset helper
const { __resetMockConfig } = await import("../lib/user-config-service") as unknown as { __resetMockConfig: () => void };

describe("proxy routes", () => {
  let app: ReturnType<typeof createProxyRouter>;

  beforeEach(() => {
    __resetMockConfig();
    app = createProxyRouter();
  });

  describe("GET /", () => {
    it("returns empty proxy config by default", async () => {
      const response = await app.request("http://localhost/");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        providers: {},
        webFetch: "",
        platforms: {},
      });
    });
  });

  describe("PUT /", () => {
    it("updates proxy config", async () => {
      const response = await app.request("http://localhost/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: { openai: "http://127.0.0.1:7890" },
          webFetch: "http://127.0.0.1:7890",
          platforms: { codex: "socks5://127.0.0.1:1080" },
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.providers.openai).toBe("http://127.0.0.1:7890");
      expect(body.webFetch).toBe("http://127.0.0.1:7890");
      expect(body.platforms.codex).toBe("socks5://127.0.0.1:1080");
    });
  });

  describe("GET /providers/:providerId", () => {
    it("returns empty string for unconfigured provider", async () => {
      const response = await app.request("http://localhost/providers/openai");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ providerId: "openai", proxy: "" });
    });

    it("returns configured proxy for a provider", async () => {
      // First set a proxy
      await app.request("http://localhost/providers/anthropic", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy: "http://127.0.0.1:7890" }),
      });

      const response = await app.request("http://localhost/providers/anthropic");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ providerId: "anthropic", proxy: "http://127.0.0.1:7890" });
    });
  });

  describe("PUT /providers/:providerId", () => {
    it("sets proxy for a single provider", async () => {
      const response = await app.request("http://localhost/providers/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy: "http://127.0.0.1:7890" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ providerId: "openai", proxy: "http://127.0.0.1:7890" });
    });

    it("clears proxy when empty string is provided", async () => {
      // Set first
      await app.request("http://localhost/providers/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy: "http://127.0.0.1:7890" }),
      });

      // Clear
      const response = await app.request("http://localhost/providers/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy: "" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ providerId: "openai", proxy: "" });
    });
  });
});
