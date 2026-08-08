import { describe, expect, it } from "vitest";
import { convertPgiQuestionToAskUserQuestion, formatOptionToAskUserOption } from "./pgi-ask-handler.js";
import type { PGIQuestion } from "../engine/jingwei/index.js";

describe("PGI AskUserQuestion contract adapter", () => {
  it("converts a PGIQuestion to NarraFork AskUserQuestion structure", () => {
    const pgiQuestion: PGIQuestion = {
      id: "conflict-escalate:c1",
      prompt: "矛盾「家族内部纷争」当前处于 escalating。本章要推到 climax 吗？",
      type: "single",
      options: ["推到 climax", "保持 escalating", "稍缓（brewing 回退）", "跳过", "多余的选项"],
      context: { conflictId: "c1" },
    };

    const askUserItem = convertPgiQuestionToAskUserQuestion(pgiQuestion);

    expect(askUserItem).not.toHaveProperty("id");
    expect(askUserItem.question).toBe("conflict-escalate:c1");
    expect(askUserItem.header).toBe("矛盾「家族内部纷争」当前处于 escalating。本章要推到 climax 吗？");
    expect(askUserItem.multiSelect).toBe(false);
    expect(askUserItem.options).toHaveLength(4);
    expect(askUserItem.options[0]).toEqual({
      label: "推到 climax",
      description: "推到 climax",
    });
  });

  it("formats string option into object with label and description", () => {
    const formatted = formatOptionToAskUserOption("保持 escalating");
    expect(formatted).toEqual({
      label: "保持 escalating",
      description: "保持 escalating",
    });
  });
});
