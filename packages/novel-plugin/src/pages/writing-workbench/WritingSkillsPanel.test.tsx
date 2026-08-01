import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OWN_SOURCE_KEY,
  WritingSkillsPanelShell,
  applyWritingSkillFilters,
  genreOf,
  groupBySource,
  kindLabel,
  type WritingSkillItem,
} from "./WritingSkillsPanel";

const BUILTIN: WritingSkillItem = {
  id: "writing-skills-chapter-close-out",
  slug: "chapter-close-out",
  name: "写后同轮清零",
  description: "每章落盘后同一轮内跑完检查。",
  kind: "workflow",
  source: "builtin",
  editable: false,
};

const CUSTOM: WritingSkillItem = {
  id: "writing-skills-my-pacing",
  slug: "my-pacing",
  name: "我的节奏法",
  description: "作者自建的节奏写作技能。",
  kind: "pacing",
  source: "user",
  editable: true,
};

describe("kindLabel", () => {
  it("把 8 个写作技能分类译成中文", () => {
    expect(kindLabel("opening")).toBe("开篇");
    expect(kindLabel("pacing")).toBe("节奏");
    expect(kindLabel("character")).toBe("人物");
    expect(kindLabel("plot")).toBe("情节");
    expect(kindLabel("prose")).toBe("文笔");
    expect(kindLabel("revision")).toBe("修订");
    expect(kindLabel("platform")).toBe("平台");
    expect(kindLabel("workflow")).toBe("流程");
  });

  it("未知分类原样返回，不显示为 undefined", () => {
    expect(kindLabel("whatever")).toBe("whatever");
  });
});

describe("WritingSkillsPanelShell", () => {
  it("列出写作技能并标注分类", () => {
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[BUILTIN, CUSTOM]} enabledIds={[]} />,
    );
    expect(html).toContain("写后同轮清零");
    expect(html).toContain("我的节奏法");
    expect(html).toContain("流程");
    expect(html).toContain("节奏");
  });

  it("只给作者副本打「已自定义」，内置不打", () => {
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[BUILTIN, CUSTOM]} enabledIds={[]} />,
    );
    // 两条里只应出现一次
    expect(html.match(/已自定义/g)).toHaveLength(1);
  });

  it("标注已启用状态", () => {
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[BUILTIN, CUSTOM]} enabledIds={[BUILTIN.id]} />,
    );
    expect(html).toContain("已启用");
    expect(html.match(/已启用/g)).toHaveLength(1);
  });

  it("按分类筛选", () => {
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[BUILTIN, CUSTOM]} enabledIds={[]} filterKind="pacing" />,
    );
    expect(html).toContain("我的节奏法");
    expect(html).not.toContain("写后同轮清零");
  });

  it("市场 skill 展示上游归属与许可（署名义务）", () => {
    const market: WritingSkillItem = {
      ...BUILTIN,
      id: "writing-skills-market",
      slug: "worldwonderer--story-long-write",
      name: "story-long-write",
      provenance: {
        repo: "https://github.com/worldwonderer/oh-story-claudecode",
        license: "MIT",
      },
    };
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[market]} enabledIds={[]} />,
    );
    expect(html).toContain("worldwonderer/oh-story-claudecode");
    expect(html).toContain("MIT");
    // 长 URL 不直接铺在卡片里
    expect(html).not.toContain("https://github.com/worldwonderer");
  });

  const mk = (i: number, repo: string | null): WritingSkillItem => ({
    ...BUILTIN,
    id: `s${i}`,
    slug: `s${i}`,
    provenance: repo ? { repo, license: "MIT" } : null,
  });

  it("按来源分区陈列：自带排最前，其余按数量倒序", () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) => mk(i, "https://github.com/lornshrimp/Lorn.NovelWriteSkills")),
      ...Array.from({ length: 2 }, (_, i) => mk(100 + i, "https://github.com/worldwonderer/oh-story-claudecode")),
      mk(200, null),
    ];
    const sections = groupBySource(many);
    // 自带的是产品保证可用的部分，固定排最前，不参与数量排序
    expect(sections[0]?.key).toBe(OWN_SOURCE_KEY);
    expect(sections[0]?.label).toBe("NovelFork 自带");
    expect(sections[1]?.key).toBe("lornshrimp/Lorn.NovelWriteSkills");
    expect(sections[1]?.count).toBe(5);
    expect(sections[2]?.count).toBe(2);
    // 分区带上仓库地址与许可，供 UI 展示归属
    expect(sections[1]?.repoUrl).toBe("https://github.com/lornshrimp/Lorn.NovelWriteSkills");
    expect(sections[1]?.license).toBe("MIT");

    const html = renderToStaticMarkup(<WritingSkillsPanelShell skills={many} enabledIds={[]} />);
    expect(html).toContain("全部 8");
    expect(html).toContain("NovelFork 自带");
  });

  it("进入某个分区后只看该仓库内容", () => {
    const many = [
      mk(1, "https://github.com/lornshrimp/Lorn.NovelWriteSkills"),
      mk(2, "https://github.com/worldwonderer/oh-story-claudecode"),
      mk(3, null),
    ];
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={many} enabledIds={[]} activeSource={OWN_SOURCE_KEY} />,
    );
    // 分区视图里只剩 1 条，但分区导航仍列全部来源
    expect(html).toContain("全部 3");
  });

  it("筛选不含来源维度：分区与筛选是平行的两个维度", () => {
    const own = { ...BUILTIN, id: "own", slug: "own", name: "自研写作技能", kind: "plot" };
    const ext = {
      ...BUILTIN,
      id: "ext",
      slug: "ext",
      name: "外部写作技能",
      kind: "plot",
      provenance: { repo: "https://github.com/worldwonderer/oh-story-claudecode", license: "MIT" },
    } satisfies WritingSkillItem;
    // 不选分区时，分类筛选跨仓库聚合
    expect(applyWritingSkillFilters([own, ext], { kind: "plot" })).toHaveLength(2);
  });

  it("搜索匹配名称、描述与标签", () => {
    const a: WritingSkillItem = { ...BUILTIN, id: "a", slug: "a", name: "番茄版输出" };
    const b: WritingSkillItem = { ...CUSTOM, id: "b", slug: "b", name: "起点版输出", tags: ["都市悬疑"] };
    expect(applyWritingSkillFilters([a, b], { query: "番茄" })).toHaveLength(1);
    expect(applyWritingSkillFilters([a, b], { query: "都市悬疑" })).toHaveLength(1);
    expect(applyWritingSkillFilters([a, b], { query: "输出" })).toHaveLength(2);
    expect(applyWritingSkillFilters([a, b], { query: "不存在的词" })).toHaveLength(0);
  });

  it("题材只认白名单 tag，普通标签不当题材", () => {
    const withGenre: WritingSkillItem = { ...BUILTIN, id: "g", slug: "g", tags: ["都市悬疑", "平台适配"] };
    const noGenre: WritingSkillItem = { ...BUILTIN, id: "n", slug: "n", tags: ["执行纪律"] };
    expect(genreOf(withGenre)).toBe("都市悬疑");
    expect(genreOf(noGenre)).toBeNull();
  });

  it("筛到空时给出可操作提示，不是空白", () => {
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[BUILTIN, CUSTOM]} enabledIds={[]} query="绝不会命中" />,
    );
    expect(html).toContain("没有匹配的写作技能");
  });

  it("自研内置不显示来源行", () => {
    const html = renderToStaticMarkup(
      <WritingSkillsPanelShell skills={[BUILTIN]} enabledIds={[]} />,
    );
    expect(html).not.toContain("来源");
  });

  it("空态告诉作者去哪自建，不显示空白", () => {
    const html = renderToStaticMarkup(<WritingSkillsPanelShell skills={[]} enabledIds={[]} />);
    expect(html).toContain("还没有写作技能");
    expect(html).toContain(".novelfork/skills");
  });
});
