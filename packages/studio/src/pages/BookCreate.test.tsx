import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
  useApi: (url: string) => {
    if (url === "/genres") {
      return {
        data: {
          genres: [
            { id: "xuanhuan", name: "玄幻", source: "builtin", language: "zh" },
          ],
        },
      };
    }
    if (url === "/project") {
      return { data: { language: "zh" } };
    }
    return { data: undefined };
  },
}));

interface MockWindowStore {
  addWindow: (input: { title: string; agentId: string; sessionId?: string; sessionMode?: "chat" | "plan" }) => void;
}

let addWindowMock = vi.fn();

vi.mock("@/stores/windowStore", () => ({
  useWindowStore: (selector: (state: MockWindowStore) => unknown) =>
    selector({
      addWindow: addWindowMock,
    }),
}));

import { BookCreate } from "./BookCreate";

describe("BookCreate", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    postApiMock.mockReset();
    addWindowMock = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a default writer session and opens a workspace after the book becomes ready", async () => {
    const nav = {
      toDashboard: vi.fn(),
      toBook: vi.fn(),
      toProjectCreate: vi.fn(),
    };

    postApiMock.mockResolvedValueOnce({ bookId: "book-demo" });
    fetchJsonMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/books/book-demo") {
        return { id: "book-demo" };
      }
      if (url === "/api/sessions" && options?.method === "POST") {
        return {
          id: "session-book-demo",
          title: "新书《仙路长明》写作会话",
          agentId: "writer",
          kind: "standalone",
          sessionMode: "chat",
          status: "active",
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          messageCount: 0,
          sortOrder: 0,
          projectId: "book-demo",
          sessionConfig: {
            providerId: "anthropic",
            modelId: "claude-sonnet-4-6",
            permissionMode: "allow",
            reasoningEffort: "medium",
          },
          recentMessages: [],
        };
      }
      throw new Error(`Unexpected fetchJson call: ${url}`);
    });

    render(
      <BookCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
        projectCreateDraft={{
          title: "仙路长明",
          projectInit: {
            repositorySource: "new",
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "xianlu-main",
          },
        }}
      />,
    );

    expect(screen.getByText(/创建完成后会自动打开默认写作会话/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建书籍并进入工作区" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postApiMock).toHaveBeenCalledWith("/books/create", expect.objectContaining({
      title: "仙路长明",
      genre: "xuanhuan",
    }));
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"projectId":"book-demo"'),
    }));
    expect(addWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "新书《仙路长明》写作会话",
      agentId: "writer",
      sessionId: "session-book-demo",
      sessionMode: "chat",
    }));
    expect(nav.toBook).toHaveBeenCalledWith("book-demo");
  });
});
