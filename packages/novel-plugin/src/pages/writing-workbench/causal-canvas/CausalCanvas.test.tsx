// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NarrativeStructurePayload } from "../../../engine/narrative-taxonomy/narrative-structure";
import { CausalCanvas } from "./CausalCanvas";

function sceneRow(id: string, chapterNumber: number, ordinal: number, title: string, patch: Record<string, unknown> = {}) {
  return {
    id, bookId: "book-1", chapterNumber, ordinal, title, summary: "", function: "advance", wordCount: 0,
    conflict: "", mood: "", outcome: "", characters: [], hooksUsed: [], hooksPlanted: [],
    layer: "canon", status: "confirmed", source: "manual", confidence: 1, createdAt: 0, updatedAt: 0, ...patch,
  };
}

function lineRow(id: string, name: string, kind: string) {
  return { id, bookId: "book-1", name, kind, lifecycle: "active", goal: "", layer: "canon", status: "confirmed", source: "manual", confidence: 1, createdAt: 0, updatedAt: 0 };
}

const baseStructure = {
  ok: true,
  bookId: "book-1",
  currentChapter: 12,
  volumes: [],
  chapters: [],
  entities: [],
  foreshadows: [],
  foreshadowThresholds: { watchChapters: 5, overdueChapters: 12 },
  storylines: [lineRow("main", "夺回师门", "main"), lineRow("romance", "感情线", "romance")],
  scenes: [
    sceneRow("s1", 1, 1, "初遇"),
    sceneRow("s2", 3, 1, "药园夜谈", { status: "needs-review", hooksPlanted: ["玉佩"] }),
  ],
  mounts: [
    { sceneId: "s1", storylineId: "main", role: "primary", createdAt: 0 },
    { sceneId: "s2", storylineId: "main", role: "primary", createdAt: 0 },
    { sceneId: "s2", storylineId: "romance", role: "supporting", createdAt: 0 },
  ],
} as unknown as NarrativeStructurePayload;

type Call = { url: string; method: string; body: any };

function mockFetch(respond: (call: Call) => { status?: number; body: unknown } | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const reply = respond(call) ?? { body: { ok: true, scenes: baseStructure.scenes, storylines: baseStructure.storylines, mounts: baseStructure.mounts } };
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCanvas(structure = baseStructure) {
  return render(<CausalCanvas bookId="book-1" structure={structure} onOpenChapter={vi.fn()} />);
}

describe("因果画布", () => {
  it("同时服务两条线的场景只画一次；左侧冻结栏列出每条线，最后是「未挂线」", () => {
    mockFetch(() => undefined);
    renderCanvas();
    expect(screen.getAllByTestId("causal-scene-s2")).toHaveLength(1);
    expect(screen.getByTestId("causal-scene-s2").textContent).toContain("待审");
    expect(screen.getByTestId("causal-scene-s2").textContent).toContain("悬 1");
    const rail = screen.getByTestId("causal-lane-rail");
    expect(within(rail).getByTestId("causal-lane-label-main").textContent).toContain("夺回师门");
    expect(within(rail).getByTestId("causal-lane-label-unmounted").textContent).toContain("未挂线");
  });

  it("点场景看它服务的线；把辅助线设为主线走改主剧情线接口，随后重读场景图", async () => {
    const calls = mockFetch(() => undefined);
    renderCanvas();
    fireEvent.click(screen.getByTestId("causal-scene-s2"));
    const inspector = screen.getByTestId("causal-inspector");
    expect(within(inspector).getByTestId("causal-mount-main").textContent).toContain("主");
    expect(within(inspector).getByTestId("causal-mount-romance").textContent).toContain("辅");
    expect(inspector.textContent).toContain("机器拆出的场景");

    fireEvent.click(within(inspector).getByRole("button", { name: "设为主线" }));
    await waitFor(() => expect(calls.some((call) => call.method === "GET" && call.url.endsWith("/scene-graph"))).toBe(true));
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: "/api/books/book-1/narrative-memory/scenes/s2/primary-storyline",
      body: { storylineId: "romance" },
    });
  });

  it("摘下挂载失败时恢复原样并说明原因", async () => {
    mockFetch((call) => (call.method === "DELETE" ? { status: 404, body: { ok: false, error: "scene-not-found", summary: "这本书里没有这个场景，可能已被删除。" } } : undefined));
    renderCanvas();
    fireEvent.click(screen.getByTestId("causal-scene-s2"));
    fireEvent.click(screen.getByRole("button", { name: "从「感情线」摘下" }));
    await waitFor(() => expect(screen.getByTestId("causal-canvas-error").textContent).toContain("可能已被删除"));
    expect(screen.getByTestId("causal-mount-romance")).toBeTruthy();
  });

  it("给场景加一条辅助线：已有主线时以辅助身份挂上", async () => {
    const calls = mockFetch(() => undefined);
    renderCanvas();
    fireEvent.click(screen.getByTestId("causal-scene-s1"));
    fireEvent.change(screen.getByLabelText("挂到剧情线"), { target: { value: "romance" } });
    fireEvent.click(screen.getByRole("button", { name: /挂上/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      url: "/api/books/book-1/narrative-memory/scenes/s1/mounts",
      body: { storylineId: "romance", role: "supporting" },
    });
  });

  it("点左侧线名看这条线：推进到哪章、停滞了几章", () => {
    mockFetch(() => undefined);
    renderCanvas();
    fireEvent.click(screen.getByTestId("causal-lane-label-main"));
    const inspector = screen.getByTestId("causal-inspector");
    expect(inspector.textContent).toContain("最近推进到第 3 章");
    expect(inspector.textContent).toContain("已 9 章没推进");
  });

  it("右侧面板平时收起；打开「说明 / 新建剧情线」后新建剧情线", async () => {
    const calls = mockFetch(() => undefined);
    renderCanvas();
    expect(screen.queryByTestId("causal-inspector")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "说明 / 新建剧情线" }));
    fireEvent.change(screen.getByLabelText("剧情线名称"), { target: { value: "师门旧案" } });
    fireEvent.change(screen.getByLabelText("剧情线类别"), { target: { value: "mystery" } });
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      url: "/api/books/book-1/narrative-memory/storylines",
      body: { name: "师门旧案", kind: "mystery" },
    });
  });

  it("没有场景时说明场景从哪里来", () => {
    mockFetch(() => undefined);
    renderCanvas({ ...baseStructure, scenes: [], mounts: [] } as NarrativeStructurePayload);
    expect(screen.getByTestId("causal-canvas-empty").textContent).toContain("写作管线");
  });
});
