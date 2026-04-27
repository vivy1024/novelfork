import { describe, it, expect } from "vitest";
import {
  buildBranchPrompt,
  parseBranchResult,
  type OutlineNode,
  type HookState,
  type ChapterSummary,
} from "../agents/outline-brancher.js";

describe("buildBranchPrompt", () => {
  const outline: OutlineNode[] = [
    { id: "ch-10", title: "决战前夕", summary: "主角集结盟友" },
    { id: "ch-11", title: "最终之战", summary: "正邪对决" },
  ];
  const hooks: HookState[] = [
    { id: "hook-1", description: "神秘信件", status: "planted" },
    { id: "hook-2", description: "失踪的师兄", status: "growing" },
  ];
  const summaries: ChapterSummary[] = [
    { chapterNumber: 8, summary: "主角突破境界" },
    { chapterNumber: 9, summary: "遭遇伏击" },
  ];

  it("包含大纲和伏笔信息", () => {
    const prompt = buildBranchPrompt(outline, hooks, "主角刚突破金丹期", summaries);
    expect(prompt).toContain("大纲分支");
    expect(prompt).toContain("决战前夕");
    expect(prompt).toContain("神秘信件");
    expect(prompt).toContain("planted");
    expect(prompt).toContain("第 8 章");
    expect(prompt).toContain("主角刚突破金丹期");
    expect(prompt).toContain("2-4");
  });
});

describe("parseBranchResult", () => {
  it("解析有效 JSON", () => {
    const response = `
这是一些前置文字。
\`\`\`json
[
  {
    "branchId": "branch-1",
    "title": "正面突破",
    "description": "主角选择正面对决",
    "chapters": [
      { "chapterNumber": 11, "title": "集结", "summary": "召集盟友" }
    ],
    "risk": "low",
    "hookImpact": ["hook-1"]
  },
  {
    "branchId": "branch-2",
    "title": "暗度陈仓",
    "description": "主角选择迂回策略",
    "chapters": [
      { "chapterNumber": 11, "title": "潜入", "summary": "暗中行动" },
      { "chapterNumber": 12, "title": "反转", "summary": "出其不意" }
    ],
    "risk": "high",
    "hookImpact": ["hook-1", "hook-2"]
  }
]
\`\`\`
`;
    const branches = parseBranchResult(response);
    expect(branches).toHaveLength(2);
    expect(branches[0].branchId).toBe("branch-1");
    expect(branches[0].risk).toBe("low");
    expect(branches[0].chapters).toHaveLength(1);
    expect(branches[1].hookImpact).toContain("hook-2");
  });

  it("无效 JSON 返回空数组", () => {
    expect(parseBranchResult("这不是 JSON")).toEqual([]);
  });

  it("无 JSON 块返回空数组", () => {
    expect(parseBranchResult("没有任何 JSON 内容")).toEqual([]);
  });
});
