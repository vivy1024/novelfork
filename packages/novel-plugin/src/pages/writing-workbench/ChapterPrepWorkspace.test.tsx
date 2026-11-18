import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.hoisted(() => vi.fn());
const mutatePendingEventMock = vi.hoisted(() => vi.fn());
const reloadStructureMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
  invalidateApiPaths: vi.fn(),
  useApi: () => ({ data: { entries: [] }, loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock("./useNarrativeStructure", () => ({
  useNarrativeStructure: () => ({
    state: {
      status: "ready",
      data: {
        volumes: [{ id: "vol-1", title: "第一卷 寒门账册", goal: "站稳外门脚跟", chapterRange: { from: 1, to: 30 } }],
        chapters: [{ number: 1, title: "催债单" }],
        scenes: [],
        foreshadows: [{ entryId: "hook-1", title: "残页暗记", urgency: "overdue", plantedChapter: 1 }],
      },
    },
    reload: reloadStructureMock,
  }),
}));

vi.mock("./narrative-pending-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./narrative-pending-events")>()),
  mutatePendingEvent: mutatePendingEventMock,
}));

import { ChapterPrepWorkspace } from "./ChapterPrepWorkspace";

describe("ChapterPrepWorkspace — 注入透视、待确认放行与结构化点菜派单", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mutatePendingEventMock.mockReset();
    reloadStructureMock.mockReset();

    fetchJsonMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/write/preflight") && init?.method === "POST") {
        return {
          ok: true,
          bookId: "book-1",
          chapterNumber: 2,
          resolvedDirective: "林舟当堂核验灵田折旧账目",
          needsUserConfirm: false,
          recentChapters: [{ number: 1, summary: "林舟拿到旧账" }],
          openHooksForChapter: [{ id: "hook-1", title: "残页暗记" }],
          overdueHooks: [],
          currentVolume: { title: "第一卷 寒门账册", goal: "站稳外门脚跟" },
          platform: null,
          formalChapterCount: 1,
          memoryHealth: { timeline: "ok", facts: "ok", style: "ok", hooks: "ok", events: "ok" },
          blockers: [],
          requiredSkillAcknowledgements: [],
          loadedSkills: [],
          missingRelevantSkills: [],
          writingSkillConstraints: { items: [], blockingCount: 0 },
          warnings: [],
          warningItems: [],
          cockpit: null,
          recallSummary: {
            estimatedTokens: 6420,
            maxTokens: 24000,
            basis: "directive",
            channels: [
              { channel: "hard", status: "ok", cardCount: 2, estimatedTokens: 1200, injectedTokens: 1200 },
              { channel: "style", status: "ok", cardCount: 3, estimatedTokens: 1850, injectedTokens: 1850 },
            ],
            activeSkills: [{ slug: "nf-write-chapter", name: "章节起草规范", loadedInSession: true }],
            voices: [{ name: "林舟", confirmedFields: ["口癖", "句长"] }],
            samples: [
              {
                key: "src-1/smp-1",
                sourceTitle: "主文风包",
                sceneType: "dialogue",
                match: "pinned",
                estimatedTokens: 420,
                droppedInPacking: false,
              },
            ],
            hooks: [{ id: "hook-1", title: "残页暗记", chapter: 1 }],
            droppedCardIds: ["facts:old-1"],
            degradedCount: 1,
            trimWarnings: ["facts:old-1：token 预算不足，卡片被丢弃。"],
          },
        };
      }
      if (url.includes("/mechanism-cards/") && init?.method === "PATCH") {
        return {
          ok: true,
          card: {
            id: "mech-pending",
            name: "冷门折旧套利",
            status: "confirmed",
          },
          warnings: [],
        };
      }
      if (url.includes("/mechanism-cards")) {
        return {
          cards: [
            {
              id: "mech-pending",
              name: "冷门折旧套利",
              emotionChain: "催债高压 -> 翻出折旧上限 -> 反扣贪墨",
              status: "needs-review",
            },
          ],
        };
      }
      if (url.includes("/style/preset")) {
        return {
          preset: {
            sources: [
              {
                id: "src-1",
                title: "主文风包",
                role: "primary_voice",
                samples: [
                  {
                    id: "smp-1",
                    sceneType: "dialogue",
                    text: "算盘珠子噼啪一响，堂下鸦雀无声。",
                    status: "confirmed",
                  },
                ],
              },
            ],
          },
        };
      }
      if (url.includes("/pending-review")) {
        return {
          bookId: "book-1",
          total: 2,
          explanation: "存在待确认资产",
          warnings: [],
          groups: [
            {
              kind: "storyline",
              label: "剧情线",
              count: 1,
              items: [
                {
                  id: "storyline:sl-1",
                  kind: "storyline",
                  typeLabel: "剧情线",
                  location: "主线",
                  summary: "剧情线草稿「外门清账暗线」",
                  resolveAt: "本面板就地确认",
                  target: { kind: "storyline", storylineId: "sl-1" },
                },
              ],
            },
            {
              kind: "voice",
              label: "声线",
              count: 1,
              items: [
                {
                  id: "voice:char-2",
                  kind: "voice",
                  typeLabel: "声线",
                  location: "角色「刘管事」",
                  summary: "声线 2 项待确认",
                  resolveAt: "角色卡 › 声线",
                  target: { kind: "jingwei-entry", entryId: "char-2" },
                },
              ],
            },
          ],
        };
      }
      if (url.includes("/storylines/sl-1/review")) {
        return { ok: true };
      }
      return {};
    });
  });

  afterEach(() => cleanup());

  it("渲染本章 AI 注入透视卡片（Token 占比、角色声线、点选置顶范文、伏笔、技能与裁剪提醒）", async () => {
    render(
      <ChapterPrepWorkspace
        bookId="book-1"
        targetChapter={{ chapterNumber: 2, title: "当堂核账", summary: "林舟当堂核验灵田折旧账目" }}
        chapterWordTarget={3000}
      />,
    );

    expect(await screen.findByTestId("prep-injection-xray-card")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/6,420 \/ 24,000 tok/u)).toBeTruthy();
    });
    expect(screen.getByTestId("prep-injection-trim-alert")).toBeTruthy();
    expect(screen.getByText("林舟")).toBeTruthy();
    expect(screen.getByText("点选置顶")).toBeTruthy();
    expect(screen.getByText("章节起草规范")).toBeTruthy();
  });

  it("展示待确认资产提醒条并支持剧情线一键就地确认、机制卡一键确认与结构化派单参数", async () => {
    const onSendToNarrator = vi.fn();
    render(
      <ChapterPrepWorkspace
        bookId="book-1"
        targetChapter={{ chapterNumber: 2, title: "当堂核账", summary: "林舟当堂核验灵田折旧账目" }}
        onSendToNarrator={onSendToNarrator}
      />,
    );

    // 1. 待确认提示条展示并展开一键就地确认剧情线
    const banner = await screen.findByTestId("prep-pending-review-banner");
    expect(banner.textContent).toContain("当前有 2 项资产");
    fireEvent.click(screen.getByTestId("prep-pending-toggle-btn"));
    const approveStorylineBtn = await screen.findByTestId("prep-inline-approve-storyline:sl-1");
    fireEvent.click(approveStorylineBtn);
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/books/book-1/narrative-memory/storylines/sl-1/review",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // 2. 机制卡 needs-review 标签与一键确认（调用 PATCH /api/books/:bookId/mechanism-cards/:cardId）
    const confirmMechBtn = await screen.findByTestId("prep-confirm-mech-mech-pending");
    fireEvent.click(confirmMechBtn);
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/books/book-1/mechanism-cards/mech-pending",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    // 3. 点选机制卡 + 范文 + 填写信息增量锚点 → 派单消息包含结构化参数
    fireEvent.click(screen.getByText("冷门折旧套利"));
    fireEvent.click(screen.getByText("算盘珠子噼啪一响，堂下鸦雀无声。"));
    fireEvent.change(screen.getByLabelText(/防注水锚点/u), {
      target: { value: "1）灵田折旧率上限 12%\n2）私账朱砂暗记" },
    });

    fireEvent.click(screen.getByTestId("prep-run-chapter"));
    expect(onSendToNarrator).toHaveBeenCalledTimes(1);
    const sentMsg = String(onSendToNarrator.mock.calls[0]?.[0] ?? "");
    expect(sentMsg).toContain(`"mech-pending"`);
    expect(sentMsg).toContain(`"src-1:smp-1"`);
    expect(sentMsg).toContain("灵田折旧率上限 12%");
    expect(sentMsg).toContain("microBeats");
  });
});
