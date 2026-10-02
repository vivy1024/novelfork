import { describe, expect, test } from "bun:test";

import { createHash } from "node:crypto";

import { BUNDLED_NARRATOR_TEAM, bundledNarratorTeamBytes } from "./bundled-narrator-team";
import {
  bundledNarratorTeamState,
  installBundledNarratorTeam,
  verifyBundledNarratorTeam,
  type BundledPluginManager,
} from "./bundled-narrator-team-service";

class FakeManager implements BundledPluginManager {
  installed = 0;
  enabled: string[] = [];
  activated: string[] = [];
  status: unknown = undefined;
  async install() {
    this.installed += 1;
    this.status = { runtimeState: "inactive" };
    return this.status;
  }
  async enable(pluginId: string) {
    this.enabled.push(pluginId);
    return {};
  }
  async activate(pluginId: string) {
    this.activated.push(pluginId);
    this.status = { runtimeState: "active" };
    return {};
  }
  async getStatus() {
    return this.status;
  }
}

describe("内置 narrator-team 发行包", () => {
  test("base64 还原的字节与清单 sha256 一致（发行资产未被篡改/损坏）", () => {
    const bytes = bundledNarratorTeamBytes();
    expect(bytes.length).toBe(69374);
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(actual).toBe(BUNDLED_NARRATOR_TEAM.sha256);
    const integrity = verifyBundledNarratorTeam();
    expect(integrity.ok).toBe(true);
  });

  test("清单带有上游同步信息（源地址/版本/许可证）", () => {
    expect(BUNDLED_NARRATOR_TEAM.sourceUrl).toContain("github.com/NarraFork/narrator-team");
    expect(BUNDLED_NARRATOR_TEAM.version).toBe("0.1.49");
    expect(BUNDLED_NARRATOR_TEAM.license).toBe("MIT");
  });
});

describe("installBundledNarratorTeam", () => {
  test("按字节走装了启动到激活全链路，幂等可再调", async () => {
    const manager = new FakeManager();
    const first = await installBundledNarratorTeam(manager);
    expect(first.status).toBe("installed");
    expect(first.runtimeState).toBe("active");
    expect(manager.installed).toBe(1);
    expect(manager.enabled).toEqual([BUNDLED_NARRATOR_TEAM.pluginId]);
    expect(manager.activated).toEqual([BUNDLED_NARRATOR_TEAM.pluginId]);

    const second = await installBundledNarratorTeam(manager);
    expect(second.status).toBe("already-active");
    expect(manager.installed).toBe(1);
  });

  test("getStatus 抛错视为未安装（实例刚启动插件管理器尚未就绪）", async () => {
    const manager: BundledPluginManager = {
      async install() { throw new Error("unused"); },
      async enable() { throw new Error("unused"); },
      async activate() { throw new Error("unused"); },
      async getStatus() { throw new Error("not initialized"); },
    };
    const state = await bundledNarratorTeamState(manager);
    expect(state.installed).toBe(false);
    expect(state.runtimeState).toBeNull();
  });
});
