import { describe, expect, it, vi, beforeEach } from "vitest";

/** 记录本轮渲染里 useApi 收到的所有路径。 */
const requestedPaths: string[] = [];
let stubs: Record<string, unknown> = {};

vi.mock("@/hooks/use-api", () => ({
  useApi: (path: string | null) => {
    if (path) requestedPaths.push(path);
    return { data: stubs[path ?? ""], loading: false, error: null, refetch: () => {} };
  },
  fetchJson: (path: string) => {
    requestedPaths.push(path);
    return Promise.resolve(stubs[path] ?? {});
  },
  putApi: () => Promise.resolve({}),
  postApi: () => Promise.resolve({}),
}));

beforeEach(() => {
  requestedPaths.length = 0;
  stubs = {};
});

const BOOK_ID = "book-writing-config";

describe("WritingConfigSection", () => {
  it("首屏只显示 Writing Skills，并且只请求新的全局和书籍作用域路由", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { WritingConfigSection } = await import("./WritingConfigSection");
    stubs["/writing-skills"] = {
      skills: [{ id: "skill-a", slug: "cool-prose", name: "冷峻叙述", description: "克制的叙述语气。", kind: "prose", source: "builtin", editable: false }],
    };
    stubs[`/books/${BOOK_ID}/writing-skills`] = { projectSkillSlugs: ["cool-prose"] };

    const html = renderToStaticMarkup(<WritingConfigSection bookId={BOOK_ID} />);

    expect(requestedPaths).toContain("/writing-skills");
    expect(requestedPaths).toContain(`/books/${BOOK_ID}/writing-skills`);
    expect(requestedPaths.join("\n")).not.toMatch(/\/presets|\/beat|\/market\/templates/);
    expect(html).toContain("Writing Skills");
    expect(html).toContain("冷峻叙述");
    expect(html).not.toContain("写作预设");
    expect(html).not.toContain("节拍模板");
  });

  it("Optional tools 使用 writing-skills.check_compliance", async () => {
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const { WritingConfigSection } = await import("./WritingConfigSection");
    render(<WritingConfigSection sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: "辅助工具" }));
    expect(screen.getByText("writing-skills.check_compliance")).toBeTruthy();
    expect(screen.queryByText("presets.check_compliance")).toBeNull();
  });
});
