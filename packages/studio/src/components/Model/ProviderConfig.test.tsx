import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderConfig } from "./ProviderConfig";

afterEach(() => {
  cleanup();
});

describe("ProviderConfig", () => {
  it("does not expose the legacy IndexedDB provider editor", () => {
    render(<ProviderConfig theme="light" />);

    expect(screen.getByText("旧模型供应商配置已停用")).toBeTruthy();
    expect(screen.queryByText("API Key")).toBeNull();
    expect(screen.queryByText("测试连接")).toBeNull();

    const link = screen.getByRole("link", { name: "打开 AI 供应商设置" });
    expect(link.getAttribute("href")).toBe("/next/settings");
  });
});
