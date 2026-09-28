import { describe, expect, it, vi } from "vitest";

import { resolvePrimaryNarratorForChapter } from "./primary-narrator";

describe("resolvePrimaryNarratorForChapter", () => {
  it("按 Runtime 主叙述者契约解析章节深链", async () => {
    const json = vi.fn(async () => ({
      items: [
        { id: "reviewer", variant: "reviewer" },
        { id: "primary-narrator", variant: "primary" },
      ],
    })) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

    await expect(resolvePrimaryNarratorForChapter("chapter/1", json)).resolves.toBe("primary-narrator");
    expect(json).toHaveBeenCalledWith("/api/narrators?chapterId=chapter%2F1&limit=100");
  });

  it("章节没有主叙述者时返回 null", async () => {
    const json = vi.fn(async () => ({ items: [{ id: "reviewer", variant: "reviewer" }] })) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;
    await expect(resolvePrimaryNarratorForChapter("chapter-2", json)).resolves.toBeNull();
  });
});
