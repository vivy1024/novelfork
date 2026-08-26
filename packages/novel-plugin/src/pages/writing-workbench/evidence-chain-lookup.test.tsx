import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  fetchJsonImpl: undefined as undefined | ((path: string) => Promise<unknown>),
}));

vi.mock("@/hooks/use-api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    readonly status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "ApiRequestError";
      this.status = options?.status;
    }
  },
  fetchJson: (path: string) => {
    if (!apiMock.fetchJsonImpl) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return apiMock.fetchJsonImpl(path);
  },
}));

import { EvidenceChainLookup } from "./NarrativeMemoryPanel";

beforeEach(() => {
  apiMock.fetchJsonImpl = () =>
    Promise.resolve({
      ok: true,
      chapterNumber: 12,
      fingerprint: "abcdef1234567890",
      createdAt: "2026-08-26T00:00:00.000Z",
      artifact: {
        chapterNumber: 12,
        sandboxIntercepted: 1,
        drafts: [
          { eventType: "hook_planted", subject: "神秘石符", predicate: "埋设于", object: "床底暗格", outcome: "intercepted-by-convergence", reason: "收敛沙漏拦截（进度 80%）" },
          { subject: "薛行之", predicate: "抵达", object: "药园", outcome: "auto-apply", eventStatus: "applied" },
          { subject: "韩立", predicate: "结盟", object: "厉飞雨", outcome: "pending-review", eventStatus: "pending" },
        ],
      },
    });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EvidenceChainLookup（T4 结算证据链查询）", () => {
  it("按章号拉取并渲染草案清单：沙漏拦截/自动应用/待审 徽标与指纹", async () => {
    render(<EvidenceChainLookup bookId="book-1" />);
    fireEvent.change(screen.getByLabelText("证据链查询章号"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /查证据链/ }));

    const result = await screen.findByTestId("evidence-chain-result");
    expect(result.textContent).toContain("第 12 章证据链");
    expect(result.textContent).toContain("abcdef12");
    expect(result.textContent).toContain("收敛沙漏拦截 1 条");
    expect(screen.getByText("沙漏拦截")).toBeTruthy();
    expect(screen.getByText("自动应用")).toBeTruthy();
    expect(screen.getByText("进入待审")).toBeTruthy();
    // 事件级最终状态透传（applied 可能因应用失败降级）
    expect(result.textContent).toContain("applied");
  });

  it("章号非法时前端校验，不发请求", async () => {
    apiMock.fetchJsonImpl = vi.fn(() => Promise.resolve({}));
    render(<EvidenceChainLookup bookId="book-1" />);
    fireEvent.click(screen.getByRole("button", { name: /查证据链/ }));
    expect(await screen.findByText(/请输入有效章号/)).toBeTruthy();
    expect(apiMock.fetchJsonImpl).not.toHaveBeenCalled();
  });

  it("404（该章无记录）显示后端 summary 提示", async () => {
    const { ApiRequestError } = (await import("@/hooks/use-api")) as { ApiRequestError: new (message: string, options?: { status?: number }) => Error };
    apiMock.fetchJsonImpl = () =>
      Promise.reject(new (ApiRequestError as unknown as new (m: string, o?: { status?: number }) => Error)("not found", { status: 404 }));
    render(<EvidenceChainLookup bookId="book-1" />);
    fireEvent.change(screen.getByLabelText("证据链查询章号"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: /查证据链/ }));
    expect(await screen.findByText(/not found/)).toBeTruthy();
  });
});
