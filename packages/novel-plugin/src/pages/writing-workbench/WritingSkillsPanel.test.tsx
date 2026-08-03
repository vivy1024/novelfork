import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Writing Skills 的作用域行为与文案。
 *
 * 用户反馈「不同书籍怎么用的一样的 skills，这应该是作品级别的设置」。
 * 实测存储层是隔离的（各写 books/<id>/book.json 的 enabledWritingSkillIds），
 * 真正的问题有两处：
 * 1. 推荐阶段 tone 劫持了题材判定（已在 recommend.test.ts 覆盖）；
 * 2. UI 文案把「全局技能库」和「书籍级开关」混在一句里，读起来像全局配置。
 *
 * 这里用**真实的 useApi**、只替换全局 fetch —— mock 掉 useApi 会把
 * 「切 path 时旧 data 是否残留」这一关键行为一起 mock 掉，测试就失去意义。
 */

/** bookId → 该书启用的 skill ids（充当服务端 book.json）。 */
const bookEnabled: Record<string, string[]> = {};
/** 记录 PUT 落库调用，验证不会把旧勾选写进新书。 */
const putCalls: Array<{ bookId: string; ids: string[] }> = [];

const SKILLS = [
  { id: "skill-a", slug: "a", name: "技能A", description: "d", kind: "opening", source: "builtin", editable: false },
  { id: "skill-b", slug: "b", name: "技能B", description: "d", kind: "pacing", source: "builtin", editable: false },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  for (const key of Object.keys(bookEnabled)) delete bookEnabled[key];
  putCalls.length = 0;

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const bookMatch = url.match(/\/api\/books\/([^/]+)\/writing-skills$/u);

    if (bookMatch && (init?.method ?? "GET").toUpperCase() === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { enabledWritingSkillIds?: string[] };
      const ids = body.enabledWritingSkillIds ?? [];
      putCalls.push({ bookId: bookMatch[1]!, ids: [...ids] });
      bookEnabled[bookMatch[1]!] = [...ids];
      return jsonResponse({ ok: true, enabledWritingSkillIds: ids });
    }
    if (bookMatch) {
      return jsonResponse({ enabledWritingSkillIds: bookEnabled[bookMatch[1]!] ?? [] });
    }
    if (url.endsWith("/api/writing-skills")) {
      return jsonResponse({ skills: SKILLS });
    }
    return jsonResponse({});
  }));

  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

/**
 * 从渲染结果里读出当前处于开启态的技能名。
 * 复用 Switch 已有的 aria-label + aria-checked，不为测试往产品代码加标记。
 */
function enabledSkillNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="switch"]')]
    .filter((node) => node.getAttribute("aria-checked") === "true")
    .map((node) => (node.getAttribute("aria-label") ?? "").replace("启用写作技能 ", ""));
}

describe("WritingSkillsPanel 的作用域文案", () => {
  it("就地说明开关是书籍级、技能库是全局，并显示本书已启用数", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    bookEnabled["book-a"] = ["skill-a", "skill-b"];
    render(<WritingSkillsPanel bookId="book-a" />);

    const hint = await waitFor(() => screen.getByTestId("writing-skills-scope-hint"));
    expect(hint.textContent).toContain("只对当前这本书生效");
    expect(hint.textContent).toContain("全局共享");
    await waitFor(() => expect(screen.getByTestId("writing-skills-scope-hint").textContent).toContain("本书已启用 2 个"));
  });

  it("换书后已启用数跟着变", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    bookEnabled["book-a"] = ["skill-a", "skill-b"];
    bookEnabled["book-b"] = ["skill-a"];

    const view = render(<WritingSkillsPanel bookId="book-a" />);
    await waitFor(() => expect(screen.getByTestId("writing-skills-scope-hint").textContent).toContain("本书已启用 2 个"));

    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(screen.getByTestId("writing-skills-scope-hint").textContent).toContain("本书已启用 1 个"));
  });
});

describe("WritingSkillsPanel 的书籍级隔离", () => {
  it("切到另一本书时不沿用上一本书的勾选", async () => {
    const { render, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    bookEnabled["book-a"] = ["skill-a", "skill-b"];
    bookEnabled["book-b"] = [];

    const view = render(<WritingSkillsPanel bookId="book-a" />);
    await waitFor(() => expect(enabledSkillNames(view.container).sort()).toEqual(["技能A", "技能B"]));

    // 切书：同一个组件实例换 bookId，与工作台切书的行为一致
    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual([]));
  });

  it("在新书里改开关，不会把上一本书的勾选一起写进去", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    bookEnabled["book-a"] = ["skill-a", "skill-b"];
    bookEnabled["book-b"] = [];

    const view = render(<WritingSkillsPanel bookId="book-a" />);
    await waitFor(() => expect(enabledSkillNames(view.container).sort()).toEqual(["技能A", "技能B"]));

    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual([]));

    putCalls.length = 0;
    const toggle = view.container.querySelector('[role="switch"][aria-label="启用写作技能 技能A"]');
    expect(toggle, "找不到技能A的开关").toBeTruthy();
    fireEvent.click(toggle as Element);

    await waitFor(() => expect(putCalls.length).toBe(1));
    expect(putCalls[0]?.bookId).toBe("book-b");
    // 只应有刚点的那一个，绝不能带上 book-a 的 skill-b
    expect(putCalls[0]?.ids).toEqual(["skill-a"]);
  });

  it("回到原书时仍能读回该书自己的勾选", async () => {
    const { render, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    bookEnabled["book-a"] = ["skill-b"];
    bookEnabled["book-b"] = [];

    const view = render(<WritingSkillsPanel bookId="book-a" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual(["技能B"]));

    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual([]));

    view.rerender(<WritingSkillsPanel bookId="book-a" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual(["技能B"]));
  });
});
