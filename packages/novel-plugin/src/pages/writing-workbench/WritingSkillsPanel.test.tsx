import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * 写作技能面板（写作台 › 技能文风 › 写作技能）降级后的行为。
 *
 * 用户口径（S-9）：这里只保留「按书启用」这一件 Runtime 做不到的事——
 * NovelFork 自带技能只存在于插件包，Runtime 扫 `.novelfork/skills` 看不到它们。
 * 技能的创建、改正文、删除归 Runtime，面板里不该再出现那些入口。
 *
 * 这里用**真实的 useApi**、只替换全局 fetch —— mock 掉 useApi 会把
 * 「切 path 时旧 data 是否残留」这一关键行为一起 mock 掉，测试就失去意义。
 */

const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
});
function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>;
}

/** bookId → 该项目磁盘中已发现的 skill slugs（充当服务端 `.novelfork/skills/` 扫描结果）。 */
const projectEnabled: Record<string, string[]> = {};
const putCalls: Array<{ bookId: string; body: Record<string, string[]> }> = [];
const requestCalls: Array<{ url: string; method: string }> = [];

const SKILLS = [
  { id: "skill-a", slug: "a", name: "技能A", description: "d", kind: "opening", source: "builtin", editable: false },
  { id: "skill-b", slug: "b", name: "技能B", description: "d", kind: "pacing", source: "builtin", editable: false },
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
};
const RETIRED_SKILL = {
  id: "retired",
  slug: "retired",
  name: "已移出内置技能",
  description: "d",
  kind: "prose",
  source: "builtin",
  editable: false,
  retiredFromBuiltin: true,
};
/** 入口技能（entry 在 WRITING_SKILL_ENTRIES 白名单里）排最前。 */
const ENTRY_SKILL = {
  id: "skill-entry",
  slug: "entry",
  name: "入口技能",
  description: "d",
  kind: "opening",
  source: "builtin",
  editable: false,
  entry: "写下一章",
};
const ALL_SKILLS = [...SKILLS, RETIRED_SKILL, ENTRY_SKILL];
const PROJECT_SKILLS = [...ALL_SKILLS, PROJECT_ONLY_SKILL];

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
    requestCalls.push({ url, method });

    const projectSkillMatch = url.match(/\/api\/books\/([^/]+)\/writing-skills\/([^/]+)$/u);
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
        const skill = ALL_SKILLS.find((candidate) => candidate.id === id);
        if (skill) current.add(skill.slug);
      }
      for (const id of body.removeSkillIds ?? []) {
        const skill = ALL_SKILLS.find((candidate) => candidate.id === id);
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
    if (/\/api\/writing-skills\/[^/]+$/u.test(url)) {
      return jsonResponse({ skill: { body: "技能正文", content: "技能正文" } });
    }
    if (url.endsWith("/api/writing-skills")) {
      return jsonResponse({ skills: ALL_SKILLS });
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
    .map((node) => (node.getAttribute("aria-label") ?? "").replace(/^(启用|停用)写作技能 /u, ""));
}

describe("WritingSkillsPanel 的按书启用", () => {
  it("就地说明开关是项目级、技能库是全局，并显示当前项目物化数", async () => {
    const { render } = await import("@testing-library/react");
    projectEnabled["book-a"] = ["a", "b"];
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    const { container } = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("启用态只对当前作品生效（当前已发现 2 个）");
    });
    expect(container.textContent).toContain("技能库与作者副本全局共享");
  });

  it("启用一个 catalog 技能写当前作品接口，不碰 book.json", async () => {
    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    const toggle = await screen.findByRole("switch", { name: "启用写作技能 入口技能" });

    fireEvent.click(toggle);

    await vi.waitFor(() => {
      expect(putCalls).toEqual([{ bookId: "book-a", body: { addSkillIds: ["skill-entry"] } }]);
    });
    expect(requestCalls.some((call) => /book\.json|\/api\/books\/book-a$/u.test(call.url))).toBe(false);
  });

  it("关闭当前作品独有技能时删除作品文件而不是发送 catalog ID", async () => {
    const { render, screen, fireEvent } = await import("@testing-library/react");
    projectEnabled["book-a"] = ["project-only"];
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    const toggle = await screen.findByRole("switch", { name: "停用写作技能 项目额外技能" });

    fireEvent.click(toggle);

    await vi.waitFor(() => {
      expect(requestCalls.some(
        (call) => call.method === "DELETE" && call.url.endsWith("/books/book-a/writing-skills/project-only"),
      )).toBe(true);
    });
    expect(putCalls).toEqual([]);
  });
});

describe("WritingSkillsPanel 的书籍级隔离", () => {
  it("切到另一本书时不沿用上一本书的勾选", async () => {
    const { render, screen, fireEvent } = await import("@testing-library/react");
    projectEnabled["book-a"] = ["a"];
    projectEnabled["book-b"] = [];
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    const first = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await vi.waitFor(() => {
      expect(enabledSkillNames(first.container)).toContain("技能A");
    });

    const second = render(<WritingSkillsPanel bookId="book-b" />, { wrapper: Providers });
    await vi.waitFor(() => {
      expect(second.container.textContent).toContain("本书已启用 0");
    });
    expect(enabledSkillNames(second.container)).toEqual([]);
    // 第二本书里技能A 回到「可启用」，开关是关的（技能A 不在入口列表，展开后可见）
    fireEvent.click(second.container.querySelector('[data-testid="writing-skills-others-toggle"]')!);
    const switchLabels = [...second.container.querySelectorAll('[role="switch"]')]
      .map((node) => node.getAttribute("aria-label") ?? "");
    expect(switchLabels).toContain("启用写作技能 技能A");
    expect(enabledSkillNames(second.container)).toEqual([]);
  });
});

describe("WritingSkillsPanel 只做按书启用", () => {
  it("不再提供改正文 / 恢复内置 / 新建 / 删除等 Runtime 侧才有的入口", async () => {
    const { render, screen } = await import("@testing-library/react");
    projectEnabled["book-a"] = ["project-only"];
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await screen.findByTestId("writing-skills-enabled");

    for (const label of ["编辑", "保存", "恢复内置", "删除", "新建技能", "导入旧 Preset", "上一页", "下一页"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    // 全局技能库 / 出处 / 题材 / 分类 的浏览筛选也已下线（那些不是本书启用）
    expect(screen.queryByTestId("writing-skills-scope-filter")).toBeNull();
    expect(screen.queryByTestId("writing-skills-source-filter")).toBeNull();
    expect(screen.queryByTestId("writing-skills-genre-filter")).toBeNull();
  });

  it("本书已启用清单按书取；作者入口排在可启用列表最前，其余默认折叠", async () => {
    const { render, screen, fireEvent } = await import("@testing-library/react");
    projectEnabled["book-a"] = ["b"];
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    const { container } = render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await screen.findByTestId("writing-skills-enabled");

    // 已启用只列本书扫到的技能
    expect(enabledSkillNames(container)).toEqual(["技能B"]);
    expect(container.textContent).toContain("本书已启用 1");

    // 入口技能在前，未展开时其余技能不渲染
    const entriesSection = screen.getByTestId("writing-skills-entries");
    expect(entriesSection.textContent).toContain("入口技能");
    expect(screen.queryByTestId("writing-skill-card-a")).toBeNull();

    fireEvent.click(screen.getByTestId("writing-skills-others-toggle"));
    expect(screen.getByTestId("writing-skill-card-a")).toBeTruthy();
  });

  it("书内已移出内置的第三方副本照常列出并标明来源已移出", async () => {
    const { render, screen } = await import("@testing-library/react");
    projectEnabled["book-a"] = ["retired"];
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    await screen.findByTestId("writing-skills-enabled");

    expect(screen.getByTestId("writing-skill-retired-badge")).toBeTruthy();
    expect(screen.getByTestId("writing-skill-card-retired").textContent).toContain("来源已移出内置");
  });

  it("空库给出建技能的指引，并指向 Runtime 的技能管理", async () => {
    const { render, screen } = await import("@testing-library/react");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/writing-skills")) return jsonResponse({ skills: [] });
      return jsonResponse({ projectSkillSlugs: [], skills: [] });
    }));
    const { WritingSkillsPanel } = await import("./WritingSkillsPanel");

    render(<WritingSkillsPanel bookId="book-a" />, { wrapper: Providers });
    expect(await screen.findByTestId("writing-skills-empty")).toBeTruthy();
  });
});
