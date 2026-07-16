import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeNarratorSummary } from "./product-contract";
import type { RuntimeNarratorRecord } from "./runtime-narrator-client";

const mocks = vi.hoisted(() => ({
  bookMountProps: [] as Array<{ bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean }>,
  standaloneMountProps: [] as Array<{ narrator: RuntimeNarratorRecord; compact?: boolean }>,
}));

vi.mock("./RuntimeNarratorPanelMount", () => ({
  RuntimeNarratorPanelMount: (props: { bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean }) => {
    mocks.bookMountProps.push(props);
    return <div data-testid="runtime-book-narrator-panel-mount-mock" data-narrator-id={props.narrator.id} />;
  },
  RuntimeStandaloneNarratorPanelMount: (props: { narrator: RuntimeNarratorRecord; compact?: boolean }) => {
    mocks.standaloneMountProps.push(props);
    return <div data-testid="runtime-standalone-narrator-panel-mount-mock" data-narrator-id={props.narrator.id} />;
  },
}));

import {
  RuntimeNarratorConversationLoader,
  RuntimeNarratorConversationRoute,
  RuntimeStandaloneNarratorConversationRoute,
} from "./RuntimeNarratorConversationRoute";

const narrator: RuntimeNarratorSummary = {
  id: "narrator-1",
  bookId: "book-1",
  title: "写作叙述者",
  status: "idle",
  capabilities: { read: true, send: true, interrupt: true },
};

const standalone: RuntimeNarratorRecord = {
  id: "standalone-1",
  chapterId: null,
  type: "primary",
  variant: "primary",
  title: "独立叙述者",
  model: "sub2api:gpt-5.6",
  reasoningEffort: "high",
  permissionMode: "default",
  planMode: false,
  cwd: null,
  status: "idle",
  substatus: [],
  traits: ["standalone"],
  messageCount: 2,
  createdAt: "2026-07-15T01:00:00.000Z",
  updatedAt: "2026-07-15T02:00:00.000Z",
  lastMessageAt: "2026-07-15T02:00:00.000Z",
  errorMessage: null,
  pinned: false,
  lastVisitedAt: null,
  working: false,
  unread: false,
  binding: { kind: "standalone" },
};

afterEach(() => {
  cleanup();
  mocks.bookMountProps.length = 0;
  mocks.standaloneMountProps.length = 0;
  vi.clearAllMocks();
});

describe("RuntimeNarratorConversationRoute", () => {
  it("只把可信书籍身份和 compact 配置交给统一 mount", () => {
    render(<RuntimeNarratorConversationRoute bookId="book-1" narrator={narrator} compact />);

    expect(screen.getByTestId("runtime-book-narrator-panel-mount-mock").getAttribute("data-narrator-id")).toBe("narrator-1");
    expect(mocks.bookMountProps.at(-1)).toEqual({ bookId: "book-1", narrator, compact: true });
  });

  it("把 canonical standalone narrator 交给独立 guard", () => {
    render(<RuntimeStandaloneNarratorConversationRoute narrator={standalone} compact />);
    expect(screen.getByTestId("runtime-standalone-narrator-panel-mount-mock").getAttribute("data-narrator-id")).toBe("standalone-1");
    expect(mocks.standaloneMountProps.at(-1)).toEqual({ narrator: standalone, compact: true });
  });

  it("loader 优先通过 bootstrap 解析可信书籍 narrator", async () => {
    const client = { getBootstrap: vi.fn(async () => ({ narrators: [narrator] })) };
    const narratorClient = { getNarrator: vi.fn(), openNarrator: vi.fn() };

    render(<RuntimeNarratorConversationLoader narratorId="narrator-1" client={client as never} narratorClient={narratorClient as never} />);

    expect((await screen.findByTestId("runtime-book-narrator-panel-mount-mock")).getAttribute("data-narrator-id")).toBe("narrator-1");
    expect(client.getBootstrap).toHaveBeenCalledOnce();
    expect(narratorClient.getNarrator).not.toHaveBeenCalled();
    expect(narratorClient.openNarrator).toHaveBeenCalledWith({
      id: "narrator-1",
      title: "写作叙述者",
      status: "idle",
    });
  });

  it("loader 在 bootstrap 未命中时加载并记录独立 narrator", async () => {
    const client = { getBootstrap: vi.fn(async () => ({ narrators: [] })) };
    const narratorClient = {
      getNarrator: vi.fn(async () => standalone),
      openNarrator: vi.fn(async () => undefined),
    };

    render(<RuntimeNarratorConversationLoader narratorId="standalone-1" client={client as never} narratorClient={narratorClient as never} />);

    expect((await screen.findByTestId("runtime-standalone-narrator-panel-mount-mock")).getAttribute("data-narrator-id")).toBe("standalone-1");
    expect(narratorClient.openNarrator).toHaveBeenCalledWith(standalone);
  });

  it("拒绝 raw chapter narrator 绕过书籍绑定，并通知外壳恢复到安全路由", async () => {
    const client = { getBootstrap: vi.fn(async () => ({ narrators: [] })) };
    const narratorClient = {
      getNarrator: vi.fn(async () => ({ ...standalone, chapterId: "chapter-1" })),
      openNarrator: vi.fn(),
    };
    const onInvalidNarrator = vi.fn();

    render(
      <RuntimeNarratorConversationLoader
        narratorId="chapter-narrator"
        client={client as never}
        narratorClient={narratorClient as never}
        onInvalidNarrator={onInvalidNarrator}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain("不能通过独立路由访问");
    expect(screen.queryByTestId("runtime-standalone-narrator-panel-mount-mock")).toBeNull();
    expect(narratorClient.openNarrator).not.toHaveBeenCalled();
    expect(onInvalidNarrator).toHaveBeenCalledWith("chapter-narrator");
  });
});
