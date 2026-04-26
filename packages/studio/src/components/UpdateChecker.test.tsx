import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.fn();
const useNovelForkMock = vi.fn();
const tMock = vi.fn((key: string) => {
  const table: Record<string, string> = {
    "update.available": "发现新版本 {v}",
    "update.download": "立即更新",
    "update.downloading": "下载中...",
    "update.changelog": "查看更新日志",
    "update.channelHint": "默认走稳定通道；Beta 通道入口已预留，后续接入。",
  };
  return table[key] ?? key;
});

vi.mock("../providers/novelfork-context", () => ({
  useNovelFork: () => useNovelForkMock(),
}));

vi.mock("../hooks/use-i18n", () => ({
  useI18n: () => ({ t: tMock }),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

import { UpdateChecker } from "./UpdateChecker";

afterEach(() => {
  cleanup();
});

describe("UpdateChecker", () => {
  beforeEach(() => {
    checkMock.mockReset();
    useNovelForkMock.mockReset();
    useNovelForkMock.mockReturnValue({ mode: "tauri" });
  });

  it("shows author-facing changelog hints when a tauri update is available", async () => {
    checkMock.mockResolvedValue({
      version: "0.0.2",
      body: "作者侧更新：设置中心现在会直接展示版本、运行时与构建来源。\n\n技术说明略。",
    });

    render(<UpdateChecker />);

    await waitFor(() => {
      expect(screen.getByText("发现新版本 0.0.2")).toBeTruthy();
    });

    expect(screen.getByText("默认走稳定通道；Beta 通道入口已预留，后续接入。")).toBeTruthy();
    expect(screen.getByText("作者侧更新：设置中心现在会直接展示版本、运行时与构建来源。")).toBeTruthy();

    const changelogLink = screen.getByRole("link", { name: "查看更新日志" });
    expect(changelogLink.getAttribute("href")).toBe("https://github.com/vivy1024/novelfork/releases");
  });
});
