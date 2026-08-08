import { describe, expect, it } from "vitest";

import { buildVolumeCockpitModel, volumeStatusLabel } from "./volume-cockpit-state";

/**
 * 卷驾驶舱模型只从 outline.volume(action=get) 返回体派生，不在前端拼造卷字段。
 * 覆盖：无卷纲引导、当前卷定位、章号脱节判定、区间/目标缺失兜底。
 */

function getResult(overrides: {
  volumes?: unknown[];
  current?: unknown;
  summary?: string;
} = {}) {
  return {
    ok: true,
    action: "get",
    outline: { volumes: overrides.volumes ?? [] },
    currentVolume: overrides.current ?? null,
    summary: overrides.summary ?? "",
  };
}

const VOL_1 = { id: "vol-1", title: "开篇", chapterRange: { from: 1, to: 20 }, goal: "立住主角", status: "done" };
const VOL_2 = { id: "vol-2", title: "试炼", chapterRange: { from: 21, to: 40 }, goal: "通过守门人试炼", status: "active" };

describe("buildVolumeCockpitModel", () => {
  it("无卷纲 → empty 状态，带引导 summary", () => {
    const model = buildVolumeCockpitModel(getResult({ summary: "尚未设置卷纲" }), 12);
    expect(model.state).toBe("empty");
    expect(model.current).toBeNull();
    expect(model.summary).toBe("尚未设置卷纲");
  });

  it("返回体不是对象 → empty 状态，不抛错", () => {
    expect(buildVolumeCockpitModel(null, 3).state).toBe("empty");
    expect(buildVolumeCockpitModel("boom", 3).state).toBe("empty");
  });

  it("当前卷落在区间内 → 计算卷序号、本章位置与剩余章数", () => {
    const model = buildVolumeCockpitModel(
      getResult({ volumes: [VOL_1, VOL_2], current: VOL_2 }),
      25,
    );
    expect(model.state).toBe("ready");
    expect(model.index).toBe(2);
    expect(model.total).toBe(20);
    expect(model.offset).toBe(5); // 25 - 21 + 1
    expect(model.remaining).toBe(15); // 40 - 25
    expect(model.inRange).toBe(true);
    expect(model.statusLabel).toBe("进行中");
    expect(model.current?.goal).toBe("通过守门人试炼");
  });

  it("章号在本卷区间外 → inRange=false，不给 offset/remaining", () => {
    const model = buildVolumeCockpitModel(
      getResult({ volumes: [VOL_1, VOL_2], current: VOL_2 }),
      45,
    );
    expect(model.inRange).toBe(false);
    expect(model.offset).toBeNull();
    expect(model.remaining).toBeNull();
  });

  it("章号未知（0）→ 不作区间判定", () => {
    const model = buildVolumeCockpitModel(
      getResult({ volumes: [VOL_2], current: VOL_2 }),
      0,
    );
    expect(model.state).toBe("ready");
    expect(model.inRange).toBeNull();
    expect(model.offset).toBeNull();
  });

  it("区间缺失 → total=0、不判定 inRange，仍展示卷与目标", () => {
    const noRange = { id: "vol-x", title: "散卷", goal: "推进", status: "planned" };
    const model = buildVolumeCockpitModel(getResult({ volumes: [noRange], current: noRange }), 5);
    expect(model.state).toBe("ready");
    expect(model.total).toBe(0);
    expect(model.inRange).toBeNull();
    expect(model.current?.title).toBe("散卷");
  });

  it("接受 current 字段（loadCurrentVolumeContext 形状）作为当前卷", () => {
    const model = buildVolumeCockpitModel(
      { outline: { volumes: [VOL_1, VOL_2] }, current: VOL_1 },
      10,
    );
    expect(model.state).toBe("ready");
    expect(model.index).toBe(1);
    expect(model.inRange).toBe(true);
  });
});

describe("volumeStatusLabel", () => {
  it("已知状态映射为中文，未知状态原样返回", () => {
    expect(volumeStatusLabel("planned")).toBe("待写");
    expect(volumeStatusLabel("active")).toBe("进行中");
    expect(volumeStatusLabel("done")).toBe("已完成");
    expect(volumeStatusLabel("weird")).toBe("weird");
  });
});
