import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WriteInjectionSection } from "./NarrativeMemoryPanel";
import type { WriteInjectionResult } from "./use-write-injection";

// 本包没开 vitest globals，RTL 的自动 cleanup 不会注册；手动清，避免跨用例 DOM 累积。
afterEach(() => {
  cleanup();
});

const apiMock = vi.hoisted(() => ({
  fetchJsonImpl: undefined as undefined | ((path: string) => Promise<unknown>),
}));

vi.mock("@/hooks/use-api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    readonly code?: string;
    readonly status?: number;
    constructor(message: string, options?: { code?: string; status?: number }) {
      super(message);
      this.name = "ApiRequestError";
      this.code = options?.code;
      this.status = options?.status;
    }
  },
  fetchJson: (path: string) => {
    if (!apiMock.fetchJsonImpl) return Promise.reject(new Error(`unexpected fetchJson: ${path}`));
    return apiMock.fetchJsonImpl(path);
  },
}));

function reportPayload(): WriteInjectionResult {
  return {
    ok: true,
    exists: true,
    logId: "log-1",
    bookId: "book-1",
    chapterNumber: 12,
    purpose: "write_chapter",
    purposeLabel: "写章",
    createdAt: "2026-06-22T01:00:00.000Z",
    totalMs: 42,
    totalEstimatedTokens: 1234,
    channels: [
      { channel: "hard", channelLabel: "硬约束", status: "ok", latencyMs: 3, candidateCount: 4, returnedCount: 4, estimatedTokens: 380, injectedTokens: 380 },
      { channel: "style", channelLabel: "文风", status: "ok", latencyMs: 9, candidateCount: 6, returnedCount: 5, estimatedTokens: 240, injectedTokens: 210 },
      { channel: "semantic", channelLabel: "语义记忆", status: "skipped", latencyMs: 0, candidateCount: 0, returnedCount: 0, estimatedTokens: 0, injectedTokens: 0 },
    ],
    style: {
      recorded: true,
      status: "ok",
      fixedCardsRecorded: true,
      fixedCards: [
        { id: "style:style-guide", title: "文风指南", estimatedTokens: 120, droppedInPacking: false },
        { id: "style:voice-constraints", title: "角色声线", estimatedTokens: 60, droppedInPacking: true },
      ],
      voices: {
        provided: true,
        recorded: true,
        characters: [{ name: "韩立", confirmedFields: ["声音定位", "长短句倾向"] }],
      },
      samples: {
        sceneTypes: {
          labels: ["动作"],
          source: "narrative-scene",
          sourceLabel: "本章场景记录",
          evidence: ["第12章第1场「突围」功能 climax → 动作"],
          attempts: [],
        },
        selected: [{
          key: "src/fight",
          sourceTitle: "参考作品",
          sceneType: "action",
          sceneTypeLabel: "动作",
          transfer: "source-only",
          transferLabel: "作品专属（只学写法）",
          match: "scene-type",
          matchLabel: "场景匹配",
          rank: 1,
          estimatedTokens: 80,
          reason: "本章需要动作场景的写法示范；作者已确认。",
          droppedInPacking: false,
        }],
        trimmed: [{
          key: "src/draft",
          sourceTitle: "参考作品",
          sceneType: "dialogue",
          sceneTypeLabel: "对话",
          rank: 3,
          estimatedTokens: 66,
          kind: "token-budget",
          kindLabel: "预算不足",
          reason: "文风通道剩余预算 0 tokens，放不下这段约 66 tokens 的范文。",
        }],
        budget: { channelBudgetTokens: 1000, reservedTokens: 180, availableTokens: 150, usedTokens: 80 },
        totals: { totalSamples: 3, confirmedSamples: 2, unconfirmedSamples: 1 },
        explanations: [],
      },
    },
    protection: {
      namedKeeps: [{ id: "character:韩立", reason: "点名实体「韩立」超过核心角色上限，仍保留。", channel: "state", kind: "named-keep", kindLabel: "点名保留" }],
      namedEntities: ["韩立"],
    },
    trimming: {
      reasons: [
        { id: "character:韩立", reason: "点名实体「韩立」超过核心角色上限，仍保留。", channel: "state", kind: "named-keep", kindLabel: "点名保留" },
        { id: "facts:stale", reason: "token 预算不足，卡片被丢弃。", channel: "facts", kind: "token-budget", kindLabel: "预算不足" },
      ],
      droppedCardIds: ["facts:stale"],
      degradedCards: [{ id: "timeline:runtime", from: "full", to: "brief" }],
    },
    notes: [],
    skills: {
      source: "current-enabled",
      note: "技能正文不进写作上下文：启用即物化到作品 .novelfork/skills/。",
      items: [{ slug: "chapter-hook", name: "强化章末钩子", entry: "写下一章", mode: "manual", estimatedTokens: 312 }],
    },
  };
}

describe("WriteInjectionSection（W6 写作注入）", () => {
  it("空结果：如实提示该章没有写作注入记录，附三段式解释", async () => {
    apiMock.fetchJsonImpl = () => Promise.resolve({
      ok: true,
      exists: false,
      chapterNumber: 7,
      purpose: "write_chapter",
      summary: "第 7 章没有「写章」的注入记录。",
      explanation: {
        whatHappened: "没有找到第 7 章最近一次写作的上下文注入记录。",
        whyItMatters: "只有经写作管线召回过上下文的章才有注入日志。",
        suggestedAction: "经「写下一章」流程写过这一章后再来查看。",
      },
    });

    render(<WriteInjectionSection bookId="book-1" currentChapter={7} />);
    fireEvent.click(screen.getByRole("button", { name: /查注入/ }));

    await waitFor(() => expect(screen.getByTestId("write-injection-empty")).toBeTruthy());
    expect(screen.getByText(/第 7 章没有/)).toBeTruthy();
    expect(screen.getByText(/发生了什么：没有找到第 7 章/)).toBeTruthy();
    expect(screen.getByText(/建议怎么做：经「写下一章」/)).toBeTruthy();
  });

  it("有记录：展示技能、文风卡片、声线字段、范文选中与裁剪、保护与裁剪、各通道注入", async () => {
    apiMock.fetchJsonImpl = (path) => {
      expect(path).toContain("/narrative-memory/write-injection?chapter=12");
      return Promise.resolve(reportPayload());
    };

    render(<WriteInjectionSection bookId="book-1" currentChapter={12} />);
    fireEvent.click(screen.getByRole("button", { name: /查注入/ }));

    await waitFor(() => expect(screen.getByTestId("write-injection-report")).toBeTruthy());

    // 概要
    expect(screen.getByText(/写章 · 第 12 章/)).toBeTruthy();
    expect(screen.getByText(/共约 1234 tokens/)).toBeTruthy();

    // 技能：名称 + 入口 + 估算体积 + 语义说明
    expect(screen.getByText("强化章末钩子")).toBeTruthy();
    expect(screen.getByText("入口·写下一章")).toBeTruthy();
    expect(screen.getByText(/约 312 tokens/)).toBeTruthy();

    // 文风：指南卡片 tokens，声线卡「全局打包时被裁」标记
    expect(screen.getByText("文风指南")).toBeTruthy();
    expect(screen.getByText(/全局打包时被裁，未进上下文/)).toBeTruthy();

    // 声线：逐角色 + 字段 chips
    expect(screen.getByTestId("write-injection-voices").textContent).toContain("韩立");
    expect(screen.getByText("声音定位")).toBeTruthy();
    expect(screen.getByText("长短句倾向")).toBeTruthy();

    // 范文：选中的 key、场景类型标签与判定来源、判定依据
    expect(screen.getByText(/第1名 · src\/fight/)).toBeTruthy();
    expect(screen.getByText(/场景类型 动作（判定来源：本章场景记录）/)).toBeTruthy();
    expect(screen.getByText(/判定依据：第12章第1场「突围」/)).toBeTruthy();

    // 被裁范文：标「被裁·预算不足」与原因
    expect(screen.getByText("被裁·预算不足")).toBeTruthy();
    expect(screen.getByText(/文风通道剩余预算 0 tokens/)).toBeTruthy();

    // 受保护：点名实体与 named-keep 原因
    expect(screen.getByText(/点名实体（超上限仍保留）/)).toBeTruthy();
    expect(screen.getByText(/点名实体「韩立」超过核心角色上限/)).toBeTruthy();

    // 裁剪：非 named-keep 的 trimReason 与降档汇总
    expect(screen.getByText("facts:stale")).toBeTruthy();
    expect(screen.getByText(/另有 1 张卡片因预算被降档/)).toBeTruthy();

    // 通道注入：skippd 通道如实标「已关闭」
    expect(screen.getByText(/语义记忆·已关闭/)).toBeTruthy();
  });

  it("章号非法时不发请求并提示", () => {
    apiMock.fetchJsonImpl = () => Promise.reject(new Error("不应发请求"));
    render(<WriteInjectionSection bookId="book-1" />);
    fireEvent.change(screen.getByLabelText("写作注入查询章号"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /查注入/ }));
    expect(screen.getByText("请输入有效章号")).toBeTruthy();
  });

  it("请求失败时显示错误", async () => {
    apiMock.fetchJsonImpl = () => Promise.reject(new Error("网络故障"));
    render(<WriteInjectionSection bookId="book-1" currentChapter={3} />);
    fireEvent.click(screen.getByRole("button", { name: /查注入/ }));
    await waitFor(() => expect(screen.getByText("网络故障")).toBeTruthy());
  });
});
