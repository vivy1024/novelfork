import { describe, expect, it } from "vitest";

import { enterFocusMode, exitFocusMode, type FocusModeState } from "./focus-mode";

const idle: FocusModeState = { active: false, restore: null };

describe("专注模式", () => {
  it("进入时收起侧栏与对话，并记下进入前的样子", () => {
    const next = enterFocusMode(idle, { sidebar: true, chat: true });
    expect(next.panes).toEqual({ sidebar: false, chat: false });
    expect(next.state).toEqual({ active: true, restore: { sidebar: true, chat: true } });
  });

  it("退出时原样恢复进入前的开合，不管进入前是开是关", () => {
    const entered = enterFocusMode(idle, { sidebar: true, chat: false });
    const exited = exitFocusMode(entered.state);
    expect(exited.panes).toEqual({ sidebar: true, chat: false });
    expect(exited.state).toEqual(idle);
  });

  it("专注中再次进入不覆盖记下的原布局", () => {
    const entered = enterFocusMode(idle, { sidebar: true, chat: true });
    const again = enterFocusMode(entered.state, { sidebar: false, chat: false });
    expect(again.state.restore).toEqual({ sidebar: true, chat: true });
  });

  it("没在专注时退出不改动任何栏", () => {
    expect(exitFocusMode(idle).panes).toBeNull();
  });
});
