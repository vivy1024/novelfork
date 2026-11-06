import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { splitChapters } from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StyleDistillationWorkspace, type StyleDistillationFetchJson } from "./StyleDistillationWorkspace";

const SPLIT_PATTERN_LABEL = "章节标题规则（可选，正则）";

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
  fireEvent.change(screen.getByLabelText(SPLIT_PATTERN_LABEL), { target: { value: "^第(\\d+)章" } });
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
      splitPattern: "^第(\\d+)章",
    });
  });

  it("分章规则输入框如实标注为正则：占位是一条真能用的规则，并说明留空自动识别（T-07）", () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    // 旧标签「章节范围提示」+ 占位「第1章至第20章」会诱导作者填章节范围，而值实际被当成分章正则。
    expect(screen.queryByLabelText("章节范围提示")).toBeNull();
    const input = screen.getByLabelText(SPLIT_PATTERN_LABEL) as HTMLInputElement;
    expect(input.placeholder).not.toMatch(/至/);
    // 照着占位填，后端切章器能直接用
    expect(splitChapters("【1】开篇\n甲。\n【2】转折\n乙。", input.placeholder).map((chapter) => chapter.title)).toEqual(["开篇", "转折"]);
    const hint = screen.getByText("留空则自动识别『第X章』『Chapter X』等标题；只支持简单规则");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
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
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("让叙述者继续这次蒸馏"));
    const resumeCall = request.mock.calls.find(([path]) => String(path).endsWith("/resume"));
    expect(resumeCall?.[0]).toBe("/api/books/book-1/style/distillations/jobs/job-2/resume");
    expect(JSON.parse(String(resumeCall?.[1]?.body))).toEqual({ retryFailed: false });
  });

  it("证据被丢弃的规则可展开查看；整批丢弃显示失败原因，过半丢弃的完成批次标「需关注」", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    const readyJob = {
      job: {
        jobId: "job-3",
        status: "ready",
        sourceName: "参考作品 A",
        rules: job.result.rules,
        samples: [],
        fingerprint: { avgSentenceLength: 18 },
        batches: [
          {
            id: "batch-001", chapterNumbers: [1, 2], status: "failed", ruleIds: [], issues: [],
            rejectedRules: [{ category: "voice", text: "叙述者用反讽口吻评点人物", evidence: "「我要給阿Ｑ做正傳」", reason: "证据未在本批原文中逐字找到" }],
            explanation: { what: "1 条模型规则因证据未在原文找到被丢弃，本批没有收录任何规则。", why: "…", next: "展开本批「被丢弃的规则」查看" },
          },
          {
            id: "batch-002", chapterNumbers: [3], status: "done", ruleIds: ["m-1"], issues: [],
            rejectedRules: [
              { category: "scene", text: "规则甲", evidence: "编造甲", reason: "证据未在本批原文中逐字找到" },
              { category: "scene", text: "规则乙", evidence: "编造乙", reason: "证据未在本批原文中逐字找到" },
            ],
            explanation: { what: "2 条模型规则因证据未在原文找到被丢弃，仅收录 1 条。", why: "…", next: "重试本批" },
          },
        ],
      },
      expectedRevision: null,
    };
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs")) return readyJob;
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    expect(screen.getByText(/3 条模型规则因证据未在原文找到被丢弃/)).toBeTruthy();
    expect(screen.getByText(/失败原因：1 条模型规则因证据未在原文找到被丢弃/)).toBeTruthy();
    expect(screen.getByText("需关注")).toBeTruthy();
    expect(screen.getByText(/需要关注：2 条模型规则/)).toBeTruthy();
    expect(screen.getByText("查看被丢弃的规则（1 条）")).toBeTruthy();
    expect(screen.getByText("查看被丢弃的规则（2 条）")).toBeTruthy();
    expect(screen.getByText("模型给的证据：「我要給阿Ｑ做正傳」")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试失败批次" })).toBeTruthy();
  });

  it("采纳完成后可一键生成本书专属技能；采纳前不显示该入口", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs") && init?.method === "POST") return job;
      if (path.endsWith("/adopt")) return { ok: true };
      if (path.endsWith("/skill-export")) return {
        slug: "book-style-memory",
        file: "/books/book-1/.novelfork/skills/book-style-memory/SKILL.md",
        content: "---\nname: 本书写法记忆\n---\n\n# 本书写法记忆",
        ruleCount: 1,
        sourceTitles: ["参考作品 A"],
      };
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    expect(screen.queryByRole("button", { name: "生成本书专属技能" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "采纳到本书文风预设" }));
    const exportButton = await screen.findByRole("button", { name: "生成本书专属技能" });
    fireEvent.click(exportButton);
    await screen.findByText(/已生成本书技能（1 条规则，来源：参考作品 A）/);
    const exportCall = request.mock.calls.find(([path]) => String(path).endsWith("/skill-export"))!;
    expect(exportCall[0]).toBe("/api/books/book-1/style/skill-export");
    expect(exportCall[1]?.method).toBe("POST");
    expect(screen.getByRole("button", { name: "复制技能内容" })).toBeTruthy();
  });

  it("多来源时并列「共同技法 / 来源差异 / 不应迁移」三列，每条带证据与出处；跨来源确认经同一采纳接口按版本串行提交", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    const comparison = {
      sources: [
        { sourceId: "s-a", sourceName: "参考作品 A", jobId: "job-1", ruleCount: 2, adoptedRuleIds: [], adoptedSampleIds: [] },
        { sourceId: "s-b", sourceName: "旧稿乙", jobId: "job-b", ruleCount: 3, adoptedRuleIds: ["b-keep"], adoptedSampleIds: ["sample-b"] },
      ],
      threshold: 0.4,
      common: [{
        category: "scene", text: "以细小动作收束情绪", sourceIds: ["s-a", "s-b"],
        members: [
          { sourceId: "s-a", sourceName: "参考作品 A", jobId: "job-1", ruleId: "rule-transfer", text: "让动作承载情绪", evidence: "第三章多处动作落点", status: "needs-review" },
          { sourceId: "s-b", sourceName: "旧稿乙", jobId: "job-b", ruleId: "b-common", text: "以细小动作收束情绪", evidence: "第2章：他把烟按灭", status: "needs-review" },
        ],
      }],
      differences: [{ sourceId: "s-b", sourceName: "旧稿乙", rules: [
        { sourceId: "s-b", sourceName: "旧稿乙", jobId: "job-b", ruleId: "b-keep", text: "长段落后接独立短句", evidence: "第4章：门开了。", status: "needs-review", category: "rhythm" },
      ] }],
      nonTransferable: [
        { sourceId: "s-a", sourceName: "参考作品 A", jobId: "job-1", ruleId: "rule-source", text: "角色惯说青云归我", evidence: "第四章角色原话", status: "confirmed", category: "voice" },
      ],
    };
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs") && init?.method === "POST") return job;
      if (path.endsWith("/compare")) return comparison;
      if (path.endsWith("/jobs/job-1/adopt")) return { revision: "revision-2" };
      if (path.endsWith("/jobs/job-b/adopt")) return { revision: "revision-3" };
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);

    const section = await screen.findByLabelText("多来源比较");
    expect(section.textContent).toContain("参考作品 A、旧稿乙");
    expect(screen.getByText("共同技法（1）")).toBeTruthy();
    expect(screen.getByText("来源差异（1）")).toBeTruthy();
    expect(screen.getByText("不应迁移（1）")).toBeTruthy();
    expect(screen.getByText("仅见于「旧稿乙」")).toBeTruthy();
    expect(screen.getByText("证据：第2章：他把烟按灭")).toBeTruthy();
    expect(screen.getByText("证据：第4章：门开了。")).toBeTruthy();
    expect(screen.getAllByText("出处：旧稿乙").length).toBeGreaterThanOrEqual(2);
    // 单来源的「写法规则」列由三列取代，范文与统计指纹保留。
    expect(screen.queryByText("写法规则")).toBeNull();
    expect(screen.getByText("范文")).toBeTruthy();

    // 当前来源的条目与单来源审阅共用同一份选择；其他来源的选择从上次采纳记录初始化。
    fireEvent.click(screen.getByRole("button", { name: "确认（参考作品 A）：让动作承载情绪" }));
    expect(screen.getByRole("button", { name: "撤回确认（旧稿乙）：长段落后接独立短句" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认（旧稿乙）：以细小动作收束情绪" }));
    fireEvent.click(screen.getByRole("button", { name: "采纳到本书文风预设" }));
    await screen.findByText(/含另外 1 个来源的选择变化/);

    const adoptCalls = request.mock.calls.filter(([path]) => String(path).endsWith("/adopt"));
    expect(adoptCalls.map(([path]) => path)).toEqual([
      "/api/books/book-1/style/distillations/jobs/job-1/adopt",
      "/api/books/book-1/style/distillations/jobs/job-b/adopt",
    ]);
    expect(JSON.parse(String(adoptCalls[0]?.[1]?.body))).toEqual({
      expectedRevision: "revision-1", confirmedRuleIds: ["rule-transfer", "rule-source"], confirmedSampleIds: ["sample-1"],
    });
    // 第二次带第一次返回的新版本；保留该来源原有的范文选择。
    expect(JSON.parse(String(adoptCalls[1]?.[1]?.body))).toEqual({
      expectedRevision: "revision-2", confirmedRuleIds: ["b-keep", "b-common"], confirmedSampleIds: ["sample-b"],
    });
  });

  it("各来源统计对比：数值按来源并列成表、基线规则按来源分列，不进三列合并", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    const baselineRule = (sourceId: string, sourceName: string, jobId: string, ratio: number) => ({
      sourceId, sourceName, jobId, ruleId: "dialogue-1", text: `对话约占文本 ${ratio}%`, evidence: `对话句占比约 ${ratio}%`, status: "needs-review", category: "dialogue",
    });
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs") && init?.method === "POST") return job;
      if (path.endsWith("/compare")) return {
        sources: [
          { sourceId: "s-a", sourceName: "参考作品 A", jobId: "job-1", adoptedRuleIds: [], adoptedSampleIds: [] },
          { sourceId: "s-b", sourceName: "旧稿乙", jobId: "job-b", adoptedRuleIds: [], adoptedSampleIds: [] },
        ],
        common: [], differences: [], nonTransferable: [],
        statistics: [
          { sourceId: "s-a", sourceName: "参考作品 A", jobId: "job-1", metrics: { dialogueRatio: 0, avgSentenceLength: 9.3 }, baselineRules: [baselineRule("s-a", "参考作品 A", "job-1", 0)] },
          { sourceId: "s-b", sourceName: "旧稿乙", jobId: "job-b", metrics: { dialogueRatio: 0.19, avgSentenceLength: 14.8 }, baselineRules: [baselineRule("s-b", "旧稿乙", "job-b", 19)] },
        ],
      };
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    const stats = await screen.findByLabelText("各来源统计对比");
    const table = stats.querySelector("table")!;
    const rows = [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("th,td")].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["指标", "参考作品 A", "旧稿乙"],
      ["平均句长", "9.3", "14.8"],
      ["对白比例", "0", "0.19"],
    ]);
    expect(stats.textContent).toContain("「旧稿乙」的基线规则");
    expect(stats.textContent).toContain("对话约占文本 0%");
    expect(stats.textContent).toContain("对话约占文本 19%");
    expect(stats.textContent).toContain("证据：对话句占比约 19%");
    // 三列里没有这些基线规则。
    expect(screen.getByText("共同技法（0）")).toBeTruthy();
    expect(screen.getByText("来源差异（0）")).toBeTruthy();
  });

  it("单来源（或比较只有一个来源）时保持原有写法规则列，不显示三列", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs") && init?.method === "POST") return job;
      if (path.endsWith("/compare")) return { sources: [{ sourceId: "s-a", sourceName: "参考作品 A", jobId: "job-1", adoptedRuleIds: [], adoptedSampleIds: [] }], common: [], differences: [], nonTransferable: [] };
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    await waitFor(() => expect(request.mock.calls.some(([path]) => String(path).endsWith("/compare"))).toBe(true));
    expect(screen.getByText("写法规则")).toBeTruthy();
    expect(screen.queryByLabelText("多来源比较")).toBeNull();
    expect(screen.queryByText(/共同技法/)).toBeNull();
  });

  it("开始前显示模型调用次数与输出上限估算", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/preview")) return { ...preview, estimate: { batchCount: 4, maxOutputTokens: 64_000, maxOutputChars: 18_400, summary: "将调用模型 4 次，送入约 2,400 字。" } };
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "预览处理范围" }));
    await screen.findByText("第 3–4 章");
    expect(screen.getByText("4 次")).toBeTruthy();
    expect(screen.getByText("约 64,000 token")).toBeTruthy();
    expect(screen.getByLabelText("用量估算").textContent).toContain("将调用模型 4 次");
  });

  it("完成后提示 N 条待审、采纳前不影响写作，并可一键采纳推荐条目", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    const readyJob = {
      job: {
        jobId: "job-9", status: "ready", sourceName: "参考作品 A",
        rules: [
          { id: "m-high", text: "让动作承载情绪", evidence: "第3章原文：「她停在门前」", transfer: "transferable", status: "needs-review", origin: "model", confidence: "high" },
          { id: "m-low", text: "环境先行人物后到", evidence: "第3章原文：「风从巷口」", transfer: "transferable", status: "needs-review", origin: "model", confidence: "low" },
          { id: "m-loose", text: "句末留白", evidence: "第3章原文：「灯影晃了一下」", transfer: "transferable", status: "needs-review", origin: "model", confidence: "medium" },
        ],
        samples: [{ id: "sample-1", sceneType: "general", text: "范文", evidence: "第3章", transfer: "source-only", status: "needs-review" }],
        fingerprint: {}, batches: [],
      },
      expectedRevision: null,
      recommendedRuleIds: ["m-high"],
    };
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs")) return readyJob;
      if (path.endsWith("/adopt-recommended")) return { revision: "rev-2", guideRuleCount: 1, adoptedRuleIds: ["m-high"] };
      if (path.endsWith("/compare")) return { sources: [] };
      throw new Error(`unexpected request: ${path}`);
    });
    const onAdopted = vi.fn();
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} onAdopted={onAdopted} />);
    await openReview(request);
    const banner = screen.getByLabelText("待审提醒");
    expect(banner.textContent).toContain("4 条待审，采纳前不会影响写作");
    expect(screen.getByText("证据部分吻合，请核对")).toBeTruthy();
    expect(screen.getByText("证据只差标点")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "采纳全部可迁移的高置信条目（1）" }));
    await screen.findByText(/已采纳 1 条推荐规则/);
    const call = request.mock.calls.find(([path]) => String(path).endsWith("/adopt-recommended"))!;
    expect(call[0]).toBe("/api/books/book-1/style/distillations/jobs/job-9/adopt-recommended");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ expectedRevision: null });
    expect(screen.getByRole("button", { name: "撤回确认：让动作承载情绪" })).toBeTruthy();
    expect(screen.queryByLabelText("待审提醒")).toBeNull();
    expect(onAdopted).toHaveBeenCalled();
  });

  it("暂停的任务显示停下的原因，而不是只写暂停", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/jobs")) return {
        job: {
          jobId: "job-10", status: "paused", sourceName: "参考作品 A", rules: job.result.rules, samples: [], fingerprint: {},
          batches: [{ id: "batch-001", chapterNumbers: [3], status: "pending", ruleIds: [], issues: [] }],
          lastError: { what: "该任务没有可用的来源快照，无法继续模型批次。", why: "…", next: "重新粘贴参考文本，新建一次蒸馏。", at: "2026-10-20T00:00:00.000Z" },
        },
        expectedRevision: null,
      };
      if (path.endsWith("/compare")) return { sources: [] };
      throw new Error(`unexpected request: ${path}`);
    });
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    await openReview(request);
    const reason = screen.getByLabelText("停下的原因");
    expect(reason.textContent).toContain("为什么停下：该任务没有可用的来源快照");
    expect(reason.textContent).toContain("建议：重新粘贴参考文本");
    // 没有推荐条目时横幅提示逐条确认，不给一键按钮。
    expect(screen.getByLabelText("待审提醒").textContent).toContain("没有能一键采纳的条目");
    expect(screen.queryByRole("button", { name: /采纳全部可迁移/ })).toBeNull();
  });

  it("切回输入阶段保留来源名称、标题规则和参考文本草稿", async () => {
    const request = vi.fn<StyleDistillationFetchJson>();
    seedPreviewRequest(request);
    render(<StyleDistillationWorkspace bookId="book-1" fetchJson={request} />);
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "预览处理范围" }));
    await screen.findByText("来源包预览");
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByDisplayValue("参考作品 A")).toBeTruthy();
    expect(screen.getByDisplayValue("^第(\\d+)章")).toBeTruthy();
    expect(screen.getByDisplayValue("第三章 雨夜。她停在门前。")).toBeTruthy();
  });
});
