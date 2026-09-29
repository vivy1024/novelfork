import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StyleDistillationWorkspace, type StyleDistillationFetchJson } from "./StyleDistillationWorkspace";

afterEach(() => cleanup());

const preview = {
  previewId: "preview-1",
  sourceName: "参考作品 A",
  chapterCount: 2,
  totalCharacters: 2400,
  chapters: [
    { chapterNumber: 3, title: "第三章 雨夜", characters: 1200 },
    { chapterNumber: 4, title: "第四章 灯下", characters: 1200 },
  ],
  coverage: { label: "第 3–4 章", estimatedOutput: "约 3 类审阅结果" },
  warnings: ["第 4 章只有片段正文。"],
};

const job = {
  id: "job-1",
  status: "completed",
  expectedRevision: "revision-1",
  result: {
    sourceName: "参考作品 A",
    rules: [
      { id: "rule-transfer", text: "让动作承载情绪", evidence: "第三章多处动作落点", transfer: "transferable", status: "needs-review" },
      { id: "rule-source", text: "角色惯说青云归我", evidence: "第四章角色原话", transfer: "source-only", status: "confirmed" },
    ],
    samples: [
      { id: "sample-1", sceneType: "dialogue", text: "只属于样文的对白", evidence: "第四章对白段", transfer: "transferable", status: "confirmed" },
    ],
    fingerprint: { avgSentenceLength: 18, vocabularyDiversity: 0.81 },
  },
};

function seedPreviewRequest(request: ReturnType<typeof vi.fn>, result = job) {
  request.mockImplementation(async (path: string) => {
    if (path.endsWith("/preview")) return preview;
    if (path.endsWith("/jobs")) return result;
    throw new Error(`unexpected request: ${path}`);
  });
}

function fillDraft() {
  fireEvent.change(screen.getByLabelText("来源名称"), { target: { value: "参考作品 A" } });
  fireEvent.change(screen.getByLabelText("章节范围提示"), { target: { value: "第3章至第4章" } });
  fireEvent.change(screen.getByLabelText("粘贴参考文本"), { target: { value: "第三章 雨夜。她停在门前。" } });
}

async function openReview(request: ReturnType<typeof vi.fn>) {
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: "预览处理范围" }));
  await screen.findByText("第 3–4 章");
  fireEvent.click(screen.getByRole("button", { name: "开始蒸馏" }));
  await screen.findByText("审阅来源：参考作品 A");
  expect(request).toHaveBeenCalled();
}

describe("StyleDistillationWorkspace", () => {
  it("空输入阻止预览请求并解释缺少的字段", () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    fireEvent.click(screen.getByRole("button", { name: "预览处理范围" }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("来源名称");
  });

  it("预览显示处理范围、章节数、字符数和来源包提醒", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    seedPreviewRequest(request);
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "预览处理范围" }));
    await screen.findByText("第 3–4 章");
    expect(screen.getByText("2 章")).toBeTruthy();
    expect(screen.getByText("2,400 字")).toBeTruthy();
    expect(screen.getByText("第三章 雨夜")).toBeTruthy();
    expect(screen.getByText("第 4 章只有片段正文。")).toBeTruthy();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      sourceName: "参考作品 A",
      text: "第三章 雨夜。她停在门前。",
      splitPattern: "第3章至第4章",
    });
  });

  it("逐条确认保留证据和迁移边界，来源专属也能确认", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    seedPreviewRequest(request);
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    expect(screen.getByText("证据：第三章多处动作落点")).toBeTruthy();
    expect(screen.getByText("作品专属")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认：让动作承载情绪" }));
    expect(screen.getByRole("button", { name: "撤回确认：让动作承载情绪" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "撤回确认：角色惯说青云归我" }));
    expect(screen.getByRole("button", { name: "确认：角色惯说青云归我" })).toBeTruthy();
  });

  it("采纳发送确认选择，待审不入选，并显示版本冲突提示", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs") && init?.method === "POST") return job;
      if (path.endsWith("/adopt")) throw Object.assign(new Error("revision changed"), { status: 409 });
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    fireEvent.click(screen.getByRole("button", { name: "确认：让动作承载情绪" }));
    fireEvent.click(screen.getByRole("button", { name: "采纳到本书文风预设" }));
    await screen.findByText(/采纳冲突/);
    const adoptCall = request.mock.calls.find(([, init]) => init?.method === "POST" && String(init?.body).includes("confirmedRuleIds"));
    expect(JSON.parse(String(adoptCall?.[1]?.body))).toEqual({
      expectedRevision: "revision-1",
      confirmedRuleIds: ["rule-transfer", "rule-source"],
      confirmedSampleIds: ["sample-1"],
    });
    expect(screen.getByText(/作品专属内容可以确认/)).toBeTruthy();
  });

  it("审阅区显示模型批次进度与失败原因，暂停任务可继续，无模型时给出叙述者入口提示", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    const pausedJob = {
      job: {
        jobId: "job-2",
        status: "paused",
        sourceName: "参考作品 A",
        rules: job.result.rules,
        samples: [],
        fingerprint: { avgSentenceLength: 18 },
        batches: [
          { id: "batch-001", chapterNumbers: [3], status: "done", ruleIds: ["m-1", "m-2"], issues: ["「环境句」与已有规则重复，已合并到先出现的那条。"] },
          { id: "batch-002", chapterNumbers: [4], status: "failed", ruleIds: [], issues: [], explanation: { what: "模型输出不符合规则格式：rules.0.evidence：必填", why: "…", next: "重试本批" } },
          { id: "batch-003", chapterNumbers: [5, 6], status: "pending", ruleIds: [], issues: [] },
        ],
      },
      expectedRevision: null,
    };
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs")) return pausedJob;
      if (path.endsWith("/resume")) throw Object.assign(new Error("网页入口当前没有可用的服务端模型，无法继续模型批次。"), { status: 422 });
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    expect(screen.getByText("已结束 2/3 批，其中 1 批失败")).toBeTruthy();
    expect(screen.getByText(/失败原因：模型输出不符合规则格式/)).toBeTruthy();
    expect(screen.getByText("新增 2 条待审规则")).toBeTruthy();
    expect(screen.getByText(/已合并到先出现的那条/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续未完成批次" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("style.distill_start"));
    const resumeCall = request.mock.calls.find(([path]) => String(path).endsWith("/resume"));
    expect(resumeCall?.[0]).toBe("/api/books/book-1/style/distillations/jobs/job-2/resume");
    expect(JSON.parse(String(resumeCall?.[1]?.body))).toEqual({ retryFailed: false });
  });

  it("切回输入阶段保留来源名称、范围提示和参考文本草稿", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    seedPreviewRequest(request);
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "预览处理范围" }));
    await screen.findByText("来源包预览");
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByDisplayValue("参考作品 A")).toBeTruthy();
    expect(screen.getByDisplayValue("第3章至第4章")).toBeTruthy();
    expect(screen.getByDisplayValue("第三章 雨夜。她停在门前。")).toBeTruthy();
  });
});
