import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PendingReviewPanel, type PendingReviewSummary } from "./PendingReviewPanel";

afterEach(() => cleanup());

function summaryWith(partial: Partial<PendingReviewSummary>): PendingReviewSummary {
  return {
    bookId: "book-1",
    total: 0,
    groups: [],
    explanation: "没有待确认项。",
    warnings: [],
    ...partial,
  };
}

function fullSummary(): PendingReviewSummary {
  return summaryWith({
    total: 6,
    explanation: "逐项去原有入口确认。",
    groups: [
      {
        kind: "voice",
        label: "声线",
        count: 1,
        items: [{ id: "voice:e1", kind: "voice", typeLabel: "声线", location: "角色「陆沉」", summary: "声线 1 项待审", resolveAt: "角色卡 › 声线", target: { kind: "jingwei-entry", entryId: "e1" } }],
      },
      {
        kind: "styleRule",
        label: "文风规则",
        count: 1,
        items: [{ id: "styleRule:ref-1:0", kind: "styleRule", typeLabel: "文风规则", location: "来源包「某参考作品」", summary: "短句收在动作前", resolveAt: "文风自动蒸馏 › 审阅", target: { kind: "style-panel" } }],
      },
      {
        kind: "foreshadow",
        label: "伏笔",
        count: 1,
        items: [{ id: "foreshadow:e2", kind: "foreshadow", typeLabel: "伏笔", location: "第 3 章埋下", summary: "断剑来历", resolveAt: "伏笔条目", target: { kind: "jingwei-entry", entryId: "e2" } }],
      },
      {
        kind: "event",
        label: "叙事事件",
        count: 1,
        items: [{ id: "event:ev1", kind: "event", typeLabel: "叙事事件", location: "第 12 章", summary: "事实：陆沉 · 学会 · 御剑", resolveAt: "写作视图「收尾」步", target: { kind: "events" } }],
      },
      {
        kind: "fact",
        label: "事实",
        count: 1,
        items: [{ id: "fact:ev2", kind: "fact", typeLabel: "事实", location: "第 3 章", summary: "关系草案：陆沉 · 信任 · 苏晚晴", resolveAt: "「章后事实 › 待审队列」", target: { kind: "events" } }],
      },
      {
        kind: "revision",
        label: "改稿",
        count: 1,
        items: [{ id: "revision:rev-3-x", kind: "revision", typeLabel: "改稿", location: "第 3 章", summary: "作者改稿：新写法", resolveAt: "文风金库 › 采纳为范文", target: { kind: "vault", chapterNumber: 3 } }],
      },
    ],
  });
}

describe("待确认聚合面板", () => {
  it("按组列出六类条目：类型、位置、摘要、去哪决定与计数", async () => {
    render(<PendingReviewPanel bookId="book-1" fetchSummary={async () => fullSummary()} />);
    await screen.findByText("待确认 6 项");
    for (const label of ["声线", "文风规则", "伏笔", "叙事事件", "事实", "改稿"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("角色「陆沉」")).toBeTruthy();
    expect(screen.getByText("第 3 章埋下")).toBeTruthy();
    expect(screen.getByText("去哪决定：文风金库 › 采纳为范文")).toBeTruthy();
    expect(screen.getByText("逐项去原有入口确认。")).toBeTruthy();
  });

  it("每个「去处理」按钮跳到宿主注入的对应入口，不重写审批", async () => {
    const handlers = {
      onOpenVoiceReview: vi.fn(),
      onOpenDistill: vi.fn(),
      onOpenJingweiEntry: vi.fn(),
      onOpenEvents: vi.fn(),
      onOpenVault: vi.fn(),
    };
    render(<PendingReviewPanel bookId="book-1" fetchSummary={async () => fullSummary()} {...handlers} />);
    const buttons = await screen.findAllByRole("button", { name: /去处理/ });
    expect(buttons).toHaveLength(6);
    fireEvent.click(buttons[0]!);
    expect(handlers.onOpenVoiceReview).toHaveBeenCalledWith("e1");
    fireEvent.click(buttons[1]!);
    expect(handlers.onOpenDistill).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[2]!);
    expect(handlers.onOpenJingweiEntry).toHaveBeenCalledWith("e2");
    fireEvent.click(buttons[3]!);
    expect(handlers.onOpenEvents).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[4]!);
    expect(handlers.onOpenEvents).toHaveBeenCalledTimes(2);
    fireEvent.click(buttons[5]!);
    expect(handlers.onOpenVault).toHaveBeenCalledTimes(1);
  });

  it("宿主没给回调时回落可用入口，仍给不了的只显示位置不伪造按钮", async () => {
    const onOpenStylePanel = vi.fn();
    const onOpenChapter = vi.fn();
    render(<PendingReviewPanel
      bookId="book-1"
      fetchSummary={async () => fullSummary()}
      onOpenStylePanel={onOpenStylePanel}
      onOpenChapter={onOpenChapter}
    />);
    const buttons = await screen.findAllByRole("button", { name: /去处理/ });
    // 只有文风规则（→ 文风页签）与改稿（→ 章节回落）有可点按钮。
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(onOpenStylePanel).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]!);
    expect(onOpenChapter).toHaveBeenCalledWith(3);
    expect(screen.getByText("角色卡 › 声线")).toBeTruthy();
    expect(screen.getByText("伏笔条目")).toBeTruthy();
  });

  it("声线在宿主只有 onOpenJingweiEntry 时回落到条目卡", async () => {
    const onOpenJingweiEntry = vi.fn();
    render(<PendingReviewPanel
      bookId="book-1"
      fetchSummary={async () => fullSummary()}
      onOpenJingweiEntry={onOpenJingweiEntry}
    />);
    const buttons = await screen.findAllByRole("button", { name: /去处理/ });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(onOpenJingweiEntry).toHaveBeenCalledWith("e1");
    fireEvent.click(buttons[1]!);
    expect(onOpenJingweiEntry).toHaveBeenCalledWith("e2");
  });

  it("空结果显示口径解释与完成态", async () => {
    render(<PendingReviewPanel bookId="book-1" fetchSummary={async () => summaryWith({ explanation: "六类来源都查过了，当前没有待处理项。" })} />);
    await screen.findByText("全部确认完");
    expect(screen.getByText("六类来源都查过了，当前没有待处理项。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /去处理/ })).toBeNull();
  });

  it("读取失败如实报错；收起回调可用时显示收起按钮", async () => {
    const onClose = vi.fn();
    render(<PendingReviewPanel bookId="book-1" fetchSummary={async () => { throw new Error("网络中断"); }} onClose={onClose} />);
    await screen.findByRole("alert");
    expect(screen.getByText("网络中断")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("部分分组有损坏告警时显示 warning，计数照常", async () => {
    const data = summaryWith({
      total: 1,
      warnings: [{ code: "STYLE_PRESET_CORRUPTED", message: "文风预设损坏，已跳过文风规则与改稿统计。" }],
      groups: [{
        kind: "voice",
        label: "声线",
        count: 1,
        items: [{ id: "voice:e1", kind: "voice", typeLabel: "声线", location: "角色「甲」", summary: "1 项待审", resolveAt: "角色卡 › 声线", target: { kind: "jingwei-entry", entryId: "e1" } }],
      }],
    });
    render(<PendingReviewPanel bookId="book-1" fetchSummary={async () => data} />);
    await screen.findByText("文风预设损坏，已跳过文风规则与改稿统计。");
    expect(screen.getByText("待确认 1 项")).toBeTruthy();
  });
});
