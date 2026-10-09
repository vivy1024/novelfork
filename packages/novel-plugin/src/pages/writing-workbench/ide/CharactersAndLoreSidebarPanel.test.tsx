import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrativeStructureState } from "../useNarrativeStructure";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

vi.mock("../character-kernel-client", () => ({
  fetchCharacterKernels: vi.fn(async () => []),
}));

const structureMock = vi.hoisted(() => ({ state: { status: "loading" } as NarrativeStructureState }));
vi.mock("../useNarrativeStructure", () => ({
  useNarrativeStructure: () => ({ state: structureMock.state, reload: () => {} }),
}));

import { fetchCharacterKernels } from "../character-kernel-client";
import { CharactersAndLoreSidebarPanel, cardReadableText } from "./CharactersAndLoreSidebarPanel";
import type { EntityFactLite } from "./CharactersAndLoreSidebarPanel";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
const capabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function entryNode(title: string, category: string, content = "条目正文", metadata: Record<string, unknown> = {}): WorkbenchResourceNode {
  return {
    id: `jingwei-entry:${title}`,
    kind: "jingwei-entry",
    title,
    content,
    capabilities,
    metadata: { category, ...metadata },
  };
}

function characterNode(title: string, aliases: string[] = [], metadata: Record<string, unknown> = {}): WorkbenchResourceNode {
  return {
    ...entryNode(title, "characters", "角色设定正文"),
    metadata: { category: "characters", aliases, ...metadata },
  };
}

function voiceFields(confirmed: number, needsReview = 0) {
  const keys = ["positioning", "sentenceLength", "catchphrases", "pauses", "signaturePatterns", "cognitiveFilter", "forbiddenPatterns", "underAnger", "underTension", "whenLying"];
  const listKeys = new Set(["catchphrases", "signaturePatterns", "forbiddenPatterns"]);
  const fields: Record<string, unknown> = {};
  keys.forEach((key, index) => {
    const status = index < confirmed ? "confirmed" : index < confirmed + needsReview ? "needs-review" : "missing";
    const empty = status === "missing";
    fields[key] = { value: listKeys.has(key) ? (empty ? [] : ["示例"]) : (empty ? "" : "示例"), status };
  });
  return { schemaVersion: 1, fields };
}

function readyStructure(partial: { currentChapter?: number; entities?: Array<Record<string, unknown>> }): NarrativeStructureState {
  return {
    status: "ready",
    data: {
      ok: true,
      bookId: "book-1",
      currentChapter: partial.currentChapter ?? 0,
      volumes: [],
      chapters: [],
      scenes: [],
      storylines: [],
      mounts: [],
      foreshadows: [],
      foreshadowThresholds: { approaching: 5, overdue: 12 },
      entities: (partial.entities ?? []) as never,
    } as never,
  };
}

function renderPanel(nodes: readonly WorkbenchResourceNode[], facts: readonly EntityFactLite[], onOpen = vi.fn()) {
  const utils = render(
    <CharactersAndLoreSidebarPanel
      bookId="book-1"
      nodes={nodes}
      facts={facts}
      selectedNodeId={null}
      onOpen={onOpen}
    />,
  );
  return { ...utils, onOpen };
}

beforeEach(() => {
  structureMock.state = { status: "loading" };
  fetchJson.mockReset().mockImplementation(async (url: string) => {
    if (String(url).includes("/jingwei/staging")) return { total: 0 };
    return {};
  });
});
afterEach(() => cleanup());

describe("CharactersAndLoreSidebarPanel 卡面一行状态", () => {
  it("只取一条状态类事实，按 状态→位置→伤势→境界 排序，性格/关系不算状态", () => {
    renderPanel(
      [characterNode("林舟")],
      [
        { subject: "林舟", predicate: "性格", object: "谨慎" },
        { subject: "林舟", predicate: "伤势", object: "左臂骨折" },
        { subject: "林舟", predicate: "位置", object: "青云镇" },
        { subject: "林舟", predicate: "境界", object: "筑基" },
        { subject: "林舟", predicate: "关系", object: "韩立" },
      ],
    );

    const status = screen.getByTestId("lore-card-status");
    expect(status.textContent).toBe("位置青云镇");
    expect(screen.queryByText("左臂骨折")).toBeNull();
    expect(screen.queryByText("谨慎")).toBeNull();
    expect(screen.queryByText("韩立")).toBeNull();
  });

  it("标题没有命中时按别名或实体身份链匹配", () => {
    renderPanel(
      [
        characterNode("林舟（化名）", ["林舟"]),
        characterNode("沈砚", [], { entryId: "entry-shen" }),
      ],
      [
        { subject: "林舟", predicate: "状态", object: "潜伏中" },
        { subject: "沈先生", subjectEntryId: "entry-shen", predicate: "所在", object: "城西仓库" },
      ],
    );

    const statuses = screen.getAllByTestId("lore-card-status").map((el) => el.textContent);
    expect(statuses).toEqual(["状态潜伏中", "所在城西仓库"]);
  });

  it("从正文截下来的半句、括号不配对和超长的状态不上卡面", () => {
    renderPanel(
      [characterNode("周岚"), characterNode("顾远"), characterNode("陆沉")],
      [
        { subject: "周岚", predicate: "位置", object: "后出现天灵务局问询室、城西…" },
        { subject: "顾远", predicate: "状态", object: "(10.5 Lux高能舱成功建立自持" },
        { subject: "陆沉", predicate: "状态", object: "他在问询室里坐了整整一夜，天亮后才被放出来，随即去了城西旧仓库找人" },
      ],
    );

    expect(screen.queryByTestId("lore-card-status")).toBeNull();
    expect(screen.queryByText(/天灵务局/)).toBeNull();
    expect(screen.queryByText(/Lux/)).toBeNull();
  });

  it("没有状态事实时用角色内核的短状态", async () => {
    vi.mocked(fetchCharacterKernels).mockResolvedValueOnce([
      { characterId: "苏澄", entryStatus: "active", fields: { stateSummary: "被软禁在城南别院", motivation: "查清父亲死因" }, updatedChapter: 3, updatedAt: "", origin: "settle" },
    ]);
    renderPanel([characterNode("苏澄")], []);

    expect((await screen.findByTestId("lore-card-status")).textContent).toBe("状态被软禁在城南别院");
    expect(screen.queryByText(/查清父亲死因/)).toBeNull();
  });
});

describe("CharactersAndLoreSidebarPanel 卡面只放四样", () => {
  it("别名、标签、长正文都不上卡面；角色定位作为唯一角标", () => {
    const longContent = "薛行之出身城西旧书店，".repeat(30);
    renderPanel(
      [characterNode("薛行之", ["薛小爷", "北帝", "行之", "(10.5 Lux高能舱成功建立自持"], { fields: { roleType: "主角", tags: ["天灵务局", "调查员"] } })],
      [],
    );

    const card = screen.getByTestId("lore-card");
    expect(within(card).getByText("薛行之")).toBeTruthy();
    expect(within(card).getAllByTestId("lore-card-badge").map((el) => el.textContent)).toEqual(["主角"]);
    expect(card.textContent).not.toContain("薛小爷");
    expect(card.textContent).not.toContain("北帝");
    expect(card.textContent).not.toContain("Lux");
    expect(card.textContent).not.toContain("角色设定正文");
    expect(card.textContent).not.toContain(longContent.slice(0, 10));
  });

  it("写成一句话的角色定位不当角标", () => {
    renderPanel([characterNode("周岚", [], { fields: { roleType: "被迫卷入天灵务局调查的旧书店店主" } })], []);
    expect(screen.queryByTestId("lore-card-badge")).toBeNull();
  });

  it("没有声线、出场数据时不显示进度行", () => {
    renderPanel([characterNode("无数据角色")], []);
    expect(screen.queryByTestId("lore-card-voice")).toBeNull();
    expect(screen.queryByTestId("lore-card-last-chapter")).toBeNull();
    expect(screen.queryByTestId("lore-card-status")).toBeNull();
  });

  it("有声线记录时显示已确认数 / 总数", () => {
    renderPanel([characterNode("薛行之", [], { fields: { voice: voiceFields(3, 2) } })], []);
    const voice = screen.getByTestId("lore-card-voice");
    expect(voice.textContent).toBe("声线 3/10");
    expect(voice.getAttribute("title")).toBe("声线 10 项：已确认 3，待审 2，待补充 5");
  });

  it("声线数据损坏时不显示进度，也不报错", () => {
    renderPanel([characterNode("坏数据", [], { fields: { voice: { schemaVersion: 9 } } })], []);
    expect(screen.queryByTestId("lore-card-voice")).toBeNull();
  });

  it("最近出场取实体索引与结算事实中较晚的一章，久未出场标「冷」", () => {
    structureMock.state = readyStructure({
      currentChapter: 30,
      entities: [
        { id: "ent:1", canonicalName: "薛行之", entityType: "character", entryId: "entry-xue", lastChapter: 28 },
        { id: "ent:2", canonicalName: "苏澄", entityType: "character", entryId: "entry-su", lastChapter: 12 },
      ],
    });
    renderPanel(
      [
        characterNode("薛行之", [], { entryId: "entry-xue" }),
        characterNode("苏澄", [], { entryId: "entry-su" }),
        characterNode("韩立"),
      ],
      [
        { subject: "薛行之", predicate: "位置", object: "问询室", sourceChapter: 29, sourceType: "event" },
        // 作者手填的事实不算出场
        { subject: "苏澄", predicate: "状态", object: "失联", sourceChapter: 29, sourceType: "manual" },
      ],
    );

    const [xue, su, han] = screen.getAllByTestId("lore-card");
    expect(within(xue).getByTestId("lore-card-last-chapter").textContent).toBe("最近出场 第 29 章");
    expect(within(xue).queryByTestId("lore-card-cold")).toBeNull();
    expect(within(su).getByTestId("lore-card-last-chapter").textContent).toBe("冷，已经 18 章没有出场最近出场 第 12 章");
    expect(within(su).getByTestId("lore-card-cold").getAttribute("title")).toBe("已经 18 章没有出场");
    expect(within(han).queryByTestId("lore-card-last-chapter")).toBeNull();
  });

  it("同一 tab 里每张卡行数一致：有一张卡有进度，其余卡也留出进度行", () => {
    renderPanel(
      [characterNode("有声线", [], { fields: { voice: voiceFields(1) } }), characterNode("无数据")],
      [],
    );
    const cards = screen.getAllByTestId("lore-card");
    expect(cards.map((card) => card.children.length)).toEqual([2, 2]);
  });
});

describe("CharactersAndLoreSidebarPanel 作品基础分类", () => {
  it("动态推进条目不进入角色册或世界录，势力归入世界录", () => {
    renderPanel(
      [
        characterNode("主角"),
        entryNode("青云宗", "factions"),
        entryNode("第一章摘要", "chapter-summaries"),
        entryNode("悬念伏笔", "foreshadowing"),
      ],
      [],
    );

    expect(screen.getByText("主角")).toBeTruthy();
    expect(screen.queryByText("青云宗")).toBeNull();
    expect(screen.queryByText("第一章摘要")).toBeNull();
    expect(screen.queryByText("悬念伏笔")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    expect(screen.getByText("青云宗")).toBeTruthy();
    expect(screen.queryByText("第一章摘要")).toBeNull();
    expect(screen.queryByText("悬念伏笔")).toBeNull();
  });

  it("按共享分类元数据显示中文标签并支持筛选", () => {
    renderPanel(
      [entryNode("宗门", "factions"), entryNode("青云山", "locations")],
      [],
    );

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    const filter = screen.getByTestId("world-category-filter");
    expect(within(filter).getByRole("button", { name: /势力/ })).toBeTruthy();
    expect(within(filter).getByRole("button", { name: /地点/ })).toBeTruthy();
    expect(screen.getAllByText("势力").length).toBeGreaterThan(0);

    fireEvent.click(within(filter).getByRole("button", { name: /地点/ }));
    expect(screen.getByText("青云山")).toBeTruthy();
    expect(screen.queryByText("宗门")).toBeNull();
  });

  it("世界录卡片的角标是分类名；条目正文不上卡面，中文状态字段可上、内部状态码不上", () => {
    renderPanel(
      [
        entryNode("天灵务局", "factions", "天灵务局成立于旧历三年，下设问询室……".repeat(5), { fields: { status: "戒严中" } }),
        entryNode("城西仓库", "locations", "仓库", { fields: { status: "needs-review" } }),
      ],
      [],
    );

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    const [faction, location] = screen.getAllByTestId("lore-card");
    expect(within(faction).getByTestId("lore-card-badge").textContent).toBe("势力");
    expect(within(faction).getByTestId("lore-card-status").textContent).toBe("状态戒严中");
    expect(faction.textContent).not.toContain("旧历三年");
    expect(within(location).getByTestId("lore-card-badge").textContent).toBe("地点");
    expect(within(location).queryByTestId("lore-card-status")).toBeNull();
    expect(location.textContent).not.toContain("needs-review");
  });

  it("世界录条目的最近一次出现取实体索引，不标「冷」", () => {
    structureMock.state = readyStructure({
      currentChapter: 40,
      entities: [{ id: "ent:w", canonicalName: "城西仓库", entityType: "location", entryId: "entry-warehouse", lastChapter: 3 }],
    });
    renderPanel([entryNode("城西仓库", "locations", "仓库", { entryId: "entry-warehouse" })], []);

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    expect(screen.getByTestId("lore-card-last-chapter").textContent).toBe("最近出现 第 3 章");
    expect(screen.queryByTestId("lore-card-cold")).toBeNull();
  });
});

describe("cardReadableText", () => {
  it("接受独立成立的短语，拒绝半句与多句", () => {
    expect(cardReadableText("左臂骨折", 24)).toBe("左臂骨折");
    expect(cardReadableText("  在青云镇养伤。", 24)).toBe("在青云镇养伤");
    expect(cardReadableText("后出现天灵务局问询室、城西…", 24)).toBeNull();
    expect(cardReadableText("(10.5 Lux高能舱成功建立自持", 24)).toBeNull();
    expect(cardReadableText("，随后离开", 24)).toBeNull();
    expect(cardReadableText("受伤。被带走", 24)).toBeNull();
    expect(cardReadableText("《青云录》传人", 24)).toBe("《青云录》传人");
    expect(cardReadableText(42, 24)).toBeNull();
  });
});

describe("CharactersAndLoreSidebarPanel 页头模具与空态模板", () => {
  it("页头给出设计板口径：这本书的骨头——人物、设定、待确认的草案，并带计数状态", () => {
    renderPanel([characterNode("薛行之"), entryNode("青云宗", "factions")], []);

    expect(screen.getByTestId("sidebar-page-head-title").textContent).toBe("作品基础");
    expect(screen.getByTestId("sidebar-page-head-sub").textContent).toContain("这本书的骨头：人物、设定、待确认的草案");
    expect(screen.getByTestId("sidebar-page-head-sub").textContent).toContain("角色 1 · 设定 1");
  });

  it("还没有角色时套空态模板：还没有 X，做主按钮即可 Z", () => {
    renderPanel([], []);

    expect(screen.getByText("还没有角色卡。")).toBeTruthy();
    fireEvent.click(screen.getByTestId("lore-empty-create"));
    expect(screen.getByText("新建角色卡")).toBeTruthy();
  });
});

describe("CharactersAndLoreSidebarPanel 点击打开", () => {
  it("点击角色卡时以该节点为参数调用 onOpen（由上层 openTab 打开主区 Tab）", () => {
    const node = characterNode("薛行之");
    const { onOpen } = renderPanel([node], []);

    fireEvent.click(screen.getByText("薛行之"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(node);
  });

  it("点击世界录条目时同样调用 onOpen", () => {
    const node = entryNode("青云山", "locations");
    const { onOpen } = renderPanel([node], []);

    fireEvent.click(screen.getByRole("button", { name: /世界录/ }));
    fireEvent.click(screen.getByText("青云山"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(node);
  });

  it("卡片是可聚焦的按钮", () => {
    renderPanel([characterNode("薛行之")], []);
    const card = screen.getByTestId("lore-card");
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("type")).toBe("button");
  });
});

describe("CharactersAndLoreSidebarPanel 新建与导入的失败提示", () => {
  it("新建条目失败时在卡片栏内显示失败信息，不再静默", async () => {
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("服务不可用");
      if (String(url).includes("/jingwei/staging")) return { total: 0 };
      return {};
    });
    renderPanel([characterNode("薛行之")], []);

    fireEvent.click(screen.getByRole("button", { name: /新角色/ }));
    fireEvent.change(screen.getByPlaceholderText(/输入角色名/), { target: { value: "新角色" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    const error = await screen.findByTestId("lore-create-error");
    expect(error.textContent).toContain("创建失败");
    expect(error.textContent).toContain("服务不可用");
  });

  it("导入失败用 destructive 色展示，成功保持 emerald", async () => {
    let fail = true;
    fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/jingwei/import")) {
        if (fail) throw new Error("bad payload");
        return { imported: 2 };
      }
      if (String(url).includes("/jingwei/staging")) return { total: 0 };
      return {};
    });
    renderPanel([characterNode("薛行之")], []);

    fireEvent.click(screen.getByRole("button", { name: /^导入$/ }));
    fireEvent.change(screen.getByPlaceholderText(/粘贴 Markdown/), { target: { value: "## 角色甲\n\n设定内容" } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    const failure = await screen.findByTestId("lore-import-result-error");
    expect(failure.className).toContain("text-destructive");
    expect(failure.className).not.toContain("text-emerald-600");

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    const success = await screen.findByTestId("lore-import-result-success");
    expect(success.className).toContain("text-emerald-600");
  });
});
