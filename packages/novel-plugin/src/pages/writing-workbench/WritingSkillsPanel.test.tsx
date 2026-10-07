import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Writing Skills 的作用域行为与文案。
 *
 * 用户反馈「不同书籍怎么用的一样的 skills，这应该是作品级别的设置」。
 * 当前 API 以各书籍项目目录 `.novelfork/skills/` 为权威，返回的 project slug 只是扫描视图。
 * 这里验证两件事：
 * 1. 推荐阶段 tone 劫持了题材判定（已在 recommend.test.ts 覆盖）；
 * 2. UI 文案明确「全局技能库/作者覆盖」与「项目级物化开关」的边界。
 *
 * 这里用**真实的 useApi**、只替换全局 fetch —— mock 掉 useApi 会把
 * 「切 path 时旧 data 是否残留」这一关键行为一起 mock 掉，测试就失去意义。
 */

// useApi 内部走 react-query，渲染前需要 provider。测试专用 client，关闭重试与缓存残留。
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
});
function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>;
}

/** bookId → 该项目磁盘中已发现的 skill slugs（充当服务端 `.novelfork/skills/` 扫描结果）。 */
const projectEnabled: Record<string, string[]> = {};
/** 记录 PUT 文件操作，验证不会把旧项目的 Skill 带进新书。 */
const putCalls: Array<{ bookId: string; body: Record<string, string[]> }> = [];
const requestCalls: Array<{ url: string; method: string; body?: unknown }> = [];

const SKILLS = [
  { id: "skill-a", slug: "a", name: "技能A", description: "d", kind: "opening", source: "builtin", editable: false },
  {
    id: "skill-b",
    slug: "b",
    name: "技能B",
    description: "d",
    kind: "pacing",
    source: "builtin",
    editable: false,
    provenance: {
      repo: "https://github.com/lornshrimp/Lorn.NovelWriteSkills",
      license: "MIT",
    },
  },
];
const PROJECT_ONLY_SKILL = {
  id: "project-only",
  slug: "project-only",
  name: "项目额外技能",
  description: "d",
  kind: "prose",
  source: "project",
  editable: true,
  body: "项目技能正文",
  content: "---\nname: 项目额外技能\ndescription: d\n---\n\n项目技能正文",
  provenance: {
    repo: "https://github.com/lornshrimp/Lorn.NovelWriteSkills",
    license: "MIT",
  },
};
const PROJECT_SKILLS = [...SKILLS, PROJECT_ONLY_SKILL];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  for (const key of Object.keys(projectEnabled)) delete projectEnabled[key];
  putCalls.length = 0;
  requestCalls.length = 0;
  testQueryClient.clear();

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requestCalls.push({ url, method, ...(parsedBody === undefined ? {} : { body: parsedBody }) });
    const projectSkillMatch = url.match(/\/api\/books\/([^/]+)\/writing-skills\/([^/]+)$/u);
    if (projectSkillMatch && method === "PUT") {
      return jsonResponse({ ok: true, skill: { ...PROJECT_ONLY_SKILL, content: (parsedBody as { content?: string })?.content } });
    }
    if (projectSkillMatch && method === "DELETE") {
      projectEnabled[projectSkillMatch[1]!] = (projectEnabled[projectSkillMatch[1]!] ?? [])
        .filter((slug) => slug !== decodeURIComponent(projectSkillMatch[2]!));
      return jsonResponse({ ok: true });
    }

    const bookMatch = url.match(/\/api\/books\/([^/]+)\/writing-skills$/u);

    if (bookMatch && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string[]>;
      const current = new Set(projectEnabled[bookMatch[1]!] ?? []);
      for (const id of body.addSkillIds ?? []) {
        const skill = SKILLS.find((candidate) => candidate.id === id);
        if (skill) current.add(skill.slug);
      }
      for (const id of body.removeSkillIds ?? []) {
        const skill = SKILLS.find((candidate) => candidate.id === id);
        if (skill) current.delete(skill.slug);
      }
      putCalls.push({ bookId: bookMatch[1]!, body });
      projectEnabled[bookMatch[1]!] = [...current];
      return jsonResponse({ ok: true, projectSkillSlugs: [...current] });
    }
    if (bookMatch) {
      const projectSlugs = projectEnabled[bookMatch[1]!] ?? [];
      return jsonResponse({
        projectSkillSlugs: projectSlugs,
        skills: projectSlugs
          .map((slug) => PROJECT_SKILLS.find((skill) => skill.slug === slug))
          .filter(Boolean),
      });
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
  it("就地说明开关是项目级、技能库是全局，并显示当前项目物化数", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-a"] = ["a", "b"];
    render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });

    const hint = await waitFor(() => screen.getByTestId("writing-skills-scope-hint"));
    expect(hint.textContent).toContain("只对当前作品生效");
    expect(hint.textContent).toContain("全局共享");
    // 路径术语收进折叠细节（主文案不直接摆出 ~/.novelfork 这类内部术语）
    expect(hint.querySelector('[data-testid="writing-skills-path-details"]')).not.toBeNull();
    expect(hint.textContent).toContain("作者副本并覆盖内置版本");
    await waitFor(() => expect(screen.getByTestId("writing-skills-scope-hint").textContent).toContain("当前目录已发现 2 个"));
  });

  it("换书后已启用数跟着变", async () => {
    const { render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-a"] = ["a", "b"];
    projectEnabled["book-b"] = ["a"];

    const view = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByTestId("writing-skills-scope-hint").textContent).toContain("当前目录已发现 2 个"));

    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(screen.getByTestId("writing-skills-scope-hint").textContent).toContain("当前目录已发现 1 个"));
  });
});

describe("WritingSkillsPanel 的出处与作用范围", () => {
  it("使用 NovelFork 原生与上游出处命名", async () => {
    const { sourceLabel } = await import("./WritingSkillsPanel");

    expect(sourceLabel("novelfork")).toBe("NovelFork 原生");
    expect(sourceLabel("lornshrimp/Lorn.NovelWriteSkills"))
      .toBe("上游 · lornshrimp/Lorn.NovelWriteSkills");
  });

  it("不把当前作品额外技能计入全局出处统计", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-c"] = ["project-only"];
    render(<WritingSkillsPanel bookId="book-c" />, { wrapper: Providers });

    await waitFor(() => {
      expect(screen.getByTestId("writing-skills-scope-filter").textContent)
        .toContain("全部 3");
    });
    expect(screen.getByTestId("writing-skills-scope-filter").textContent)
      .toContain("全局技能库 2");
    expect(screen.getByTestId("writing-skills-scope-filter").textContent)
      .toContain("当前作品额外 1");
    expect(screen.getByRole("button", {
      name: "上游 · lornshrimp/Lorn.NovelWriteSkills 1",
    })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "当前作品额外 1" }));
    await waitFor(() => expect(screen.getByText("项目额外技能")).toBeTruthy());
    expect(screen.getByText("当前作品")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全局技能库 2" }));
    await waitFor(() => expect(screen.queryByText("项目额外技能")).toBeNull());
  });

  it("编辑项目独有技能时只写当前作品接口", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-c"] = ["project-only"];
    render(<WritingSkillsPanel bookId="book-c" />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByText("项目额外技能")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "编辑写作技能 项目额外技能" }));
    const editor = await screen.findByLabelText("写作技能正文");
    fireEvent.change(editor, { target: { value: PROJECT_ONLY_SKILL.content.replace("项目技能正文", "当前作品已更新") } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(requestCalls.some((call) => (
      call.method === "PUT" && call.url.endsWith("/api/books/book-c/writing-skills/project-only")
    ))).toBe(true));
    expect(requestCalls.some((call) => (
      call.method === "PUT" && call.url.endsWith("/api/writing-skills/project-only")
    ))).toBe(false);
    expect(requestCalls.some((call) => (
      call.method === "PUT"
      && call.url.endsWith("/api/books/book-c/writing-skills/project-only")
      && (call.body as { content?: string })?.content?.includes("当前作品已更新")
    ))).toBe(true);
  });

  it("关闭项目独有技能时删除当前作品文件而不是发送 catalog ID", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-c"] = ["project-only"];
    const view = render(<WritingSkillsPanel bookId="book-c" />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByText("项目额外技能")).toBeTruthy());
    const toggle = view.container.querySelector('[role="switch"][aria-label="启用写作技能 项目额外技能"]');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as Element);

    await waitFor(() => expect(requestCalls.some((call) => (
      call.method === "DELETE" && call.url.endsWith("/api/books/book-c/writing-skills/project-only")
    ))).toBe(true));
    expect(putCalls).toEqual([]);
  });
});

describe("WritingSkillsPanel 的书籍级隔离", () => {
  it("切到另一本书时不沿用上一本书的勾选", async () => {
    const { render, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-a"] = ["a", "b"];
    projectEnabled["book-b"] = [];

    const view = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await waitFor(() => expect(enabledSkillNames(view.container).sort()).toEqual(["技能A", "技能B"]));

    // 切书：同一个组件实例换 bookId，与工作台切书的行为一致
    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual([]));
  });

  it("在新书里改开关，不会把上一本书的勾选一起写进去", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-a"] = ["a", "b"];
    projectEnabled["book-b"] = [];

    const view = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await waitFor(() => expect(enabledSkillNames(view.container).sort()).toEqual(["技能A", "技能B"]));

    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual([]));

    putCalls.length = 0;
    const toggle = view.container.querySelector('[role="switch"][aria-label="启用写作技能 技能A"]');
    expect(toggle, "找不到技能A的开关").toBeTruthy();
    fireEvent.click(toggle as Element);

    await waitFor(() => expect(putCalls.length).toBe(1));
    expect(putCalls[0]?.bookId).toBe("book-b");
    // 只应有刚点的一个增量操作，绝不能把 book-a 的其它文件带进来
    expect(putCalls[0]?.body).toEqual({ addSkillIds: ["skill-a"] });
  });

  it("回到原书时仍能读回该书自己的勾选", async () => {
    const { render, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    projectEnabled["book-a"] = ["b"];
    projectEnabled["book-b"] = [];

    const view = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual(["技能B"]));

    view.rerender(<WritingSkillsPanel bookId="book-b" />);
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual([]));

    view.rerender(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await waitFor(() => expect(enabledSkillNames(view.container)).toEqual(["技能B"]));
  });
});

describe("WritingSkillsPanel 的作者入口、已移出内置标记与可选来源", () => {
  const ENTRY_CATALOG = [
    { id: "nf-review-chapter", slug: "nf-review-chapter", name: "审阅章节正文", description: "d", kind: "revision", source: "builtin", editable: false, entry: "审这一章" },
    { id: "nf-chapter-hook", slug: "nf-chapter-hook", name: "强化章末钩子", description: "d", kind: "pacing", source: "builtin", editable: false, entry: null },
    { id: "nf-progress", slug: "nf-progress", name: "看进度", description: "d", kind: "workflow", source: "builtin", editable: false, entry: "看进度" },
  ];
  const RETIRED = {
    id: "nf-lornshrimp--通用-强化章末钩子",
    slug: "nf-lornshrimp--通用-强化章末钩子",
    name: "通用-强化章末钩子",
    description: "旧版内置",
    kind: "pacing",
    source: "project",
    editable: true,
    retiredFromBuiltin: true,
    provenance: { repo: "https://github.com/lornshrimp/Lorn.NovelWriteSkills", license: "UNSPECIFIED" },
  };

  function stubCatalog() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (/\/api\/books\/[^/]+\/writing-skills$/u.test(url)) {
        return jsonResponse({ projectSkillSlugs: [RETIRED.slug], skills: [RETIRED] });
      }
      if (url.endsWith("/api/writing-skills")) return jsonResponse({ skills: ENTRY_CATALOG });
      return jsonResponse({});
    }));
  }

  it("入口按固定顺序排在最前，其余技能默认折叠，点开后出现", async () => {
    const { fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");
    stubCatalog();

    render(<WritingSkillsPanel bookId="book-entry" />, { wrapper: Providers });
    const entries = await waitFor(() => screen.getByTestId("writing-skills-entries"));
    const names = [...entries.querySelectorAll('[data-testid^="writing-skill-card-"]')]
      .map((node) => node.getAttribute("data-testid"));
    expect(names).toEqual(["writing-skill-card-nf-progress", "writing-skill-card-nf-review-chapter"]);
    expect(within(entries).getByText("入口 · 看进度")).toBeTruthy();
    // 纪律：入口技能是推荐≠默认启用，没启用的入口明说「推荐启用」，不撒谎
    expect(within(entries).getAllByText("推荐启用")).toHaveLength(2);
    expect(within(entries).queryByText("已启用")).toBeNull();

    const toggle = screen.getByTestId("writing-skills-others-toggle");
    expect(toggle.textContent).toContain("更多技能（2）· 叙述者自己会调用");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("强化章末钩子")).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("强化章末钩子")).toBeTruthy());
  });

  it("书内已移出内置的第三方副本照常列出并标明来源已移出", async () => {
    const { fireEvent, render, screen, waitFor } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");
    stubCatalog();

    render(<WritingSkillsPanel bookId="book-retired" />, { wrapper: Providers });
    await waitFor(() => screen.getByTestId("writing-skills-entries"));
    fireEvent.click(screen.getByTestId("writing-skills-others-toggle"));

    const card = await waitFor(() => screen.getByTestId(`writing-skill-card-${RETIRED.slug}`));
    expect(card.textContent).toContain("来源已移出内置");
    expect(card.textContent).toContain("本书里的副本照常生效");
    expect(card.textContent).toContain("lornshrimp/Lorn.NovelWriteSkills · UNSPECIFIED");
    const toggle = card.querySelector('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
  });

  it("可选技能来源只列许可明确的仓库，并说明放进作者技能目录即可加载", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { OptionalSkillSourcesNote } = await import("./WritingSkillsPanel");

    render(<OptionalSkillSourcesNote />);
    const note = screen.getByTestId("writing-skills-optional-sources");
    expect(note.textContent).toContain("worldwonderer/oh-story-claudecode");
    expect(note.textContent).toContain("MIT");
    expect(note.textContent).toContain("作者技能目录");
    expect(note.textContent).not.toContain("lornshrimp");
    expect(note.textContent).not.toContain("mane23-ai");
    expect(note.textContent).not.toContain("zy-zmc");
    const links = [...note.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(links).toContain("https://github.com/worldwonderer/oh-story-claudecode");
  });
});

describe("WritingSkillsPanelShell 徽标与主面板同口径", () => {
  it("已启用标「已启用」，未启用的入口技能标「推荐启用」", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { WritingSkillsPanelShell } = await import("./WritingSkillsPanel");
    type ShellProps = Parameters<typeof WritingSkillsPanelShell>[0];
    const skills = [
      { id: "s-on", slug: "s-on", name: "已启用技能", description: "d", kind: "revision", source: "builtin", editable: false, entry: null },
      { id: "s-entry", slug: "s-entry", name: "入口技能", description: "d", kind: "revision", source: "builtin", editable: false, entry: "审这一章" },
      { id: "s-plain", slug: "s-plain", name: "普通技能", description: "d", kind: "pacing", source: "builtin", editable: false, entry: null },
    ] as unknown as ShellProps["skills"];
    render(<WritingSkillsPanelShell skills={skills} enabledSlugs={["s-on"]} />);

    expect(screen.getByText("已启用")).toBeTruthy();
    // 推荐≠默认启用：没启用的入口明说「推荐启用」，普通技能不给任何启用徽标
    expect(screen.getByText("推荐启用")).toBeTruthy();
    const plainCard = screen.getByText("普通技能").closest("div")!;
    expect(plainCard.textContent).not.toContain("已启用");
    expect(plainCard.textContent).not.toContain("推荐启用");
  });
});
