import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.fn();
const fetchJsonMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { AgentPanel } from "./AgentPanel";

describe("AgentPanel AI gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/project/model-overrides") {
        return {
          data: { overrides: {} },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/providers/status") {
        return {
          data: { status: { hasUsableModel: false } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("blocks workbench agent test when no model is configured", async () => {
    render(
      <AgentPanel
        nav={{ toDashboard: vi.fn(), toWorkflow: vi.fn(), toAdmin: vi.fn() }}
        theme="light"
        t={((key: string) => key) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Writer/ }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(fetchJsonMock).not.toHaveBeenCalledWith("/llm/test", expect.anything());
  });
});
