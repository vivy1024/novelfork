import { describe, expect, it } from "vitest";

import {
  resolveCompletionsUrls,
  resolveEndpointUrls,
  resolveMessagesUrls,
  resolveModelsUrls,
  resolveResponsesUrls,
  trimTrailingSlash,
} from "./url-resolver";

describe("url-resolver", () => {
  describe("trimTrailingSlash", () => {
    it("removes trailing slashes", () => {
      expect(trimTrailingSlash("https://api.example.com/")).toBe("https://api.example.com");
      expect(trimTrailingSlash("https://api.example.com///")).toBe("https://api.example.com");
    });

    it("leaves URLs without trailing slash unchanged", () => {
      expect(trimTrailingSlash("https://api.example.com")).toBe("https://api.example.com");
      expect(trimTrailingSlash("https://api.example.com/v1")).toBe("https://api.example.com/v1");
    });
  });

  describe("resolveEndpointUrls", () => {
    it("returns single URL when baseUrl ends with /v1", () => {
      expect(resolveEndpointUrls("https://api.example.com/v1", "/chat/completions"))
        .toEqual(["https://api.example.com/v1/chat/completions"]);
    });

    it("returns two candidates when baseUrl does not end with /v1", () => {
      expect(resolveEndpointUrls("https://api.example.com", "/chat/completions"))
        .toEqual([
          "https://api.example.com/chat/completions",
          "https://api.example.com/v1/chat/completions",
        ]);
    });

    it("handles trailing slash in baseUrl", () => {
      expect(resolveEndpointUrls("https://api.example.com/v1/", "/models"))
        .toEqual(["https://api.example.com/v1/models"]);
    });
  });

  describe("resolveModelsUrls", () => {
    it("resolves /models for v1 base", () => {
      expect(resolveModelsUrls("https://api.example.com/v1"))
        .toEqual(["https://api.example.com/v1/models"]);
    });

    it("resolves /models with fallback for non-v1 base", () => {
      expect(resolveModelsUrls("https://api.example.com"))
        .toEqual([
          "https://api.example.com/models",
          "https://api.example.com/v1/models",
        ]);
    });
  });

  describe("resolveCompletionsUrls", () => {
    it("resolves /chat/completions", () => {
      expect(resolveCompletionsUrls("https://api.example.com/v1"))
        .toEqual(["https://api.example.com/v1/chat/completions"]);
    });
  });

  describe("resolveResponsesUrls", () => {
    it("resolves /responses", () => {
      expect(resolveResponsesUrls("https://api.openai.com/v1"))
        .toEqual(["https://api.openai.com/v1/responses"]);
    });

    it("resolves /responses with fallback", () => {
      expect(resolveResponsesUrls("https://api.openai.com"))
        .toEqual([
          "https://api.openai.com/responses",
          "https://api.openai.com/v1/responses",
        ]);
    });
  });

  describe("resolveMessagesUrls", () => {
    it("resolves /messages for v1 base", () => {
      expect(resolveMessagesUrls("https://api.anthropic.com/v1"))
        .toEqual(["https://api.anthropic.com/v1/messages"]);
    });

    it("resolves /messages with both /v1/messages and /messages for non-v1 base", () => {
      expect(resolveMessagesUrls("https://api.anthropic.com"))
        .toEqual([
          "https://api.anthropic.com/v1/messages",
          "https://api.anthropic.com/messages",
        ]);
    });
  });
});
