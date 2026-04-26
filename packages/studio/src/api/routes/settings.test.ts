import { describe, expect, it, vi } from "vitest";

import { createSettingsRouter } from "./settings";

describe("settings release route", () => {
  it("returns author-facing release metadata for the current build", async () => {
    const buildReleaseSnapshot = vi.fn(async (root: string) => ({
      appName: "NovelFork Studio",
      version: "0.0.1",
      runtime: "bun",
      runtimeLabel: "Bun 本地单体",
      buildSource: "bun-source-server",
      buildLabel: "源码启动（Bun）",
      commit: "abc123def456",
      changelogUrl: "https://github.com/vivy1024/novelfork/releases",
      summary: "把版本、运行时与更新节奏放到作者看得懂的位置。",
      channels: [
        {
          id: "stable" as const,
          label: "稳定通道",
          description: "默认推荐，适合长期连载。",
          available: true,
          current: true,
        },
        {
          id: "beta" as const,
          label: "Beta 通道",
          description: "预留入口。",
          available: false,
        },
      ],
      changelog: [
        {
          title: "版本信息终于说人话了",
          summary: "作者能直接知道自己手上的工作台来自哪套构建。",
          highlights: ["显示版本、运行时与构建来源"],
        },
      ],
    }));

    const app = createSettingsRouter({
      root: "D:/DESKTOP/novelfork",
      buildReleaseSnapshot,
    });

    const response = await app.request("http://localhost/release");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      appName: "NovelFork Studio",
      version: "0.0.1",
      runtime: "bun",
      buildSource: "bun-source-server",
      commit: "abc123def456",
      channels: expect.arrayContaining([
        expect.objectContaining({ id: "stable", current: true }),
        expect.objectContaining({ id: "beta", available: false }),
      ]),
      changelog: expect.arrayContaining([
        expect.objectContaining({ title: "版本信息终于说人话了" }),
      ]),
    });
    expect(buildReleaseSnapshot).toHaveBeenCalledWith("D:/DESKTOP/novelfork");
  });
});
