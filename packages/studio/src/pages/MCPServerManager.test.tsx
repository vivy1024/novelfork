import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock, postApiMock, putApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  postApiMock: vi.fn(),
  putApiMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: useApiMock,
  postApi: postApiMock,
  putApi: putApiMock,
}));

import { MCPServerManager } from "./MCPServerManager";

describe("MCPServerManager", () => {
  beforeEach(() => {
    useApiMock.mockReturnValue({
      data: {
        summary: {
          totalServers: 2,
          connectedServers: 1,
          enabledTools: 3,
          discoveredTools: 5,
          allowTools: 2,
          promptTools: 1,
          denyTools: 2,
          policySource: "runtimeControls.toolAccess",
          mcpStrategy: "inherit",
        },

        servers: [
          {
            id: "server-1",
            name: "Filesystem",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            status: "connected",
            tools: [
              { name: "read_file", description: "Read a file", access: "allow", source: "runtimeControls.toolAccess.mcpStrategy", reason: "MCP tool is allowed by runtimeControls.toolAccess.mcpStrategy=allow", reasonKey: "mcp-strategy-allow" },
              { name: "write_file", description: "Write a file", access: "prompt", source: "runtimeControls.toolAccess.mcpStrategy", reason: "MCP tool requires confirmation because runtimeControls.toolAccess.mcpStrategy=ask", reasonKey: "mcp-strategy-prompt" },
            ],
            toolCount: 2,
          },
        ],
      },
      refetch: vi.fn(),
    });
    postApiMock.mockResolvedValue({ ok: true });
    putApiMock.mockResolvedValue({ ok: true });
  });

  it("renders registry summary and discovered tool counts", () => {
    render(<MCPServerManager nav={{}} theme="light" t={(key: string) => key} />);

    expect(screen.getByText("MCP Server 管理")).toBeTruthy();
    expect(screen.getByText(/已注册 Server/)).toBeTruthy();
    expect(screen.getAllByText(/已发现工具/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Filesystem/)).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 个工具/)).toBeTruthy();
    expect(screen.getByText(/allow 2 \/ prompt 1 \/ deny 2/)).toBeTruthy();
    expect(screen.getByText("allow")).toBeTruthy();
    expect(screen.getByText("prompt")).toBeTruthy();
    expect(screen.getAllByText(/来源：runtimeControls.toolAccess.mcpStrategy/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("治理总览")).toBeTruthy();
    expect(screen.getByText("策略来源：runtimeControls.toolAccess")).toBeTruthy();
    expect(screen.getByText("MCP 默认策略：inherit")).toBeTruthy();
    expect(screen.getByText("治理解释：MCP 策略直接允许")).toBeTruthy();
    expect(screen.getByText("治理解释：MCP 策略要求确认")).toBeTruthy();
    expect(screen.getAllByText("调用执行链：遵循 Settings 的重试 / trace / dump 配置").length).toBeGreaterThanOrEqual(1);
  });

  it("allows editing an existing server and saving through the MCP API", () => {
    render(<MCPServerManager nav={{}} theme="light" t={(key: string) => key} />);

    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]!);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Filesystem Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(putApiMock).toHaveBeenCalledWith(
      "/mcp/servers/server-1",
      expect.objectContaining({
        name: "Filesystem Updated",
        transport: "stdio",
      }),
    );
  });
});
