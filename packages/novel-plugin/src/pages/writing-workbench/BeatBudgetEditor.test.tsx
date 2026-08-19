/**
 * 情节点预算编辑器：只验作者能不能改节奏、本地校验有没有如实反馈。
 * 权威校验在后端 scene.spec / pipeline.write，这里不测后端行为。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BeatBudgetEditor } from "./BeatBudgetEditor";
import type { BeatBudgetItem } from "../../handlers/beat-budget";

afterEach(() => cleanup());

/** 受控组件测试宿主：把 onChange 回写成 state，模拟真实使用。 */
function Harness({ chapterTarget, initial }: { chapterTarget: number; initial?: readonly BeatBudgetItem[] }) {
  const [beats, setBeats] = useState<readonly BeatBudgetItem[]>(initial ?? []);
  return <BeatBudgetEditor chapterTarget={chapterTarget} value={beats} onChange={setBeats} />;
}

describe("BeatBudgetEditor", () => {
  it("新增情节点后出现可编辑行", () => {
    render(<Harness chapterTarget={3000} />);

    expect(screen.queryByTestId("beat-editor-summary-0")).toBeNull();
    fireEvent.click(screen.getByTestId("beat-editor-add"));

    expect(screen.getByTestId("beat-editor-summary-0")).toBeTruthy();
    expect(screen.getByTestId("beat-editor-words-0")).toBeTruthy();
  });

  it("删除情节点后行数减少", () => {
    render(<Harness chapterTarget={3000} initial={[
      { summary: "赵铭要求改标注", density: "dense", words: 1500 },
      { summary: "回工位写脚本留底", density: "normal", words: 1500 },
    ]} />);

    expect(screen.getByTestId("beat-editor-summary-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("beat-editor-remove-0"));

    expect(screen.queryByTestId("beat-editor-summary-1")).toBeNull();
    expect((screen.getByTestId("beat-editor-summary-0") as HTMLInputElement).value).toBe("回工位写脚本留底");
  });

  it("上移交换相邻情节点顺序", () => {
    render(<Harness chapterTarget={3000} initial={[
      { summary: "第一点：地铁通话", density: "normal", words: 1500 },
      { summary: "第二点：工位对峙", density: "dense", words: 1500 },
    ]} />);

    fireEvent.click(screen.getByTestId("beat-editor-up-1"));

    expect((screen.getByTestId("beat-editor-summary-0") as HTMLInputElement).value).toBe("第二点：工位对峙");
    expect((screen.getByTestId("beat-editor-summary-1") as HTMLInputElement).value).toBe("第一点：地铁通话");
  });

  it("修改摘要会回写到受控值", () => {
    render(<Harness chapterTarget={3000} initial={[
      { summary: "旧描述", density: "normal", words: 3000 },
    ]} />);

    fireEvent.change(screen.getByTestId("beat-editor-summary-0"), { target: { value: "赵铭当场要求改标注" } });

    expect((screen.getByTestId("beat-editor-summary-0") as HTMLInputElement).value).toBe("赵铭当场要求改标注");
  });

  it("字数偏离目标时本地校验文案跟着变并给出提示", () => {
    render(<Harness chapterTarget={3000} initial={[
      { summary: "赵铭要求改标注", density: "dense", words: 1500 },
      { summary: "回工位写脚本留底", density: "normal", words: 1500 },
    ]} />);

    const before = screen.getByTestId("beat-editor-budget-line").textContent ?? "";
    expect(before).toContain("3000");

    fireEvent.change(screen.getByTestId("beat-editor-words-0"), { target: { value: "100" } });

    const after = screen.getByTestId("beat-editor-budget-line").textContent ?? "";
    expect(after).not.toBe(before);
    // 总和明显低于本章目标，必须给出可见提示而不是静默通过。
    expect(screen.getAllByTestId("beat-editor-finding").length).toBeGreaterThan(0);
  });

  it("拿不到本章目标字数时如实显示未知，不编造默认值", () => {
    render(<Harness chapterTarget={0} initial={[
      { summary: "赵铭要求改标注", density: "dense", words: 1500 },
    ]} />);

    expect(screen.getByTestId("beat-editor-budget-line").textContent).toContain("未知本章目标字数");
    expect(screen.queryByTestId("beat-editor-findings")).toBeNull();
  });

  it("disabled 时不接受编辑", () => {
    const onChange = vi.fn();
    render(
      <BeatBudgetEditor
        chapterTarget={3000}
        value={[{ summary: "赵铭要求改标注", density: "dense", words: 1500 }]}
        onChange={onChange}
        disabled
      />,
    );

    expect((screen.getByTestId("beat-editor-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("beat-editor-summary-0") as HTMLInputElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
