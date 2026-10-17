/**
 * T-38：设置向导认供应商与列模型，要和 Runtime 原生向导口径一致。
 *
 * Runtime 读设置时会把 openai/anthropic/geminiProviders 并进 customApiProviders，所以这三类
 * 天然被认到；真正漏的是 Codex——它的账号不在任何 *Providers 数组里，只靠 codexAvailable
 * 标志与 codexModels 列表表达。另外原生向导会排除 agent.disabledProviders 里的前缀。
 */
import { describe, expect, it } from "vitest";

import { buildRuntimeModelOptions, countConfiguredProviders } from "./runtime-settings-utils";

describe("countConfiguredProviders（向导第 2 步）", () => {
  it("只登录了 Codex 也算已配好供应商", () => {
    expect(countConfiguredProviders({ codexAvailable: true })).toBe(1);
  });

  it("Codex 前缀被禁用时不算", () => {
    expect(countConfiguredProviders({ codexAvailable: true, agent: { disabledProviders: ["codex"] } })).toBe(0);
  });

  it("被禁用前缀的自定义供应商不算，没填密钥的也不算", () => {
    expect(countConfiguredProviders({
      customApiProviders: [
        { id: "a", prefix: "a", apiKey: "k" },
        { id: "b", prefix: "b", apiKey: "k" },
        { id: "c", prefix: "c", apiKey: "" },
        { id: "d", prefix: "d", apiKey: "k", disabled: true },
      ],
      agent: { disabledProviders: ["b"] },
    })).toBe(1);
  });

  it("NUG 需要同时有密钥和地址", () => {
    expect(countConfiguredProviders({
      nugProviders: [
        { id: "n1", prefix: "n1", apiKey: "k", baseUrl: "https://x" },
        { id: "n2", prefix: "n2", apiKey: "k", baseUrl: "" },
      ],
    })).toBe(1);
  });

  it("什么都没配时为 0", () => {
    expect(countConfiguredProviders({})).toBe(0);
  });
});

describe("buildRuntimeModelOptions（向导第 3 步）", () => {
  it("Codex 可用时列出 codex 模型，值带 codex: 前缀", () => {
    const values = buildRuntimeModelOptions({ codexAvailable: true, codexModels: ["gpt-6-sol", "gpt-6-luna"] })
      .map((model) => model.value);
    expect(values).toEqual(["codex:gpt-6-sol", "codex:gpt-6-luna"]);
  });

  it("Codex 不可用或被禁用时不列", () => {
    expect(buildRuntimeModelOptions({ codexAvailable: false, codexModels: ["gpt-6-sol"] })).toEqual([]);
    expect(buildRuntimeModelOptions({
      codexAvailable: true,
      codexModels: ["gpt-6-sol"],
      agent: { disabledProviders: ["codex"] },
    })).toEqual([]);
  });

  it("隐藏的 codex 模型不列", () => {
    const values = buildRuntimeModelOptions({
      codexAvailable: true,
      codexModels: ["gpt-6-sol", "gpt-6-luna"],
      agent: { hiddenModels: ["codex:gpt-6-luna"] },
    }).map((model) => model.value);
    expect(values).toEqual(["codex:gpt-6-sol"]);
  });
});
