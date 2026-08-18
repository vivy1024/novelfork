/**
 * 去 AI 味路由的契约测试。
 *
 * 这条路由是「本地纯规则」通道：必须 0 模型调用、同步返回，并且把
 * 「已确定性改写」与「需语义判断」两段分开返回 —— 前端据此决定是直接
 * 应用候选，还是转交叙述者。
 */

import { describe, expect, it } from "vitest";
import { createFilterRouter } from "./filter.js";

const app = createFilterRouter();

async function postDeslop(body: unknown): Promise<{ status: number; json: any }> {
  const response = await app.request("/api/filter/deslop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = response.status === 200 || response.status === 400 ? await response.json() : null;
  return { status: response.status, json };
}

describe("POST /api/filter/deslop", () => {
  it("返回确定性改写结果与需语义判断的标注两段", async () => {
    const { status, json } = await postDeslop({
      text: "他不禁抬起头。他感到紧张。他不是害怕，而是绝望。",
    });

    expect(status).toBe(200);
    // 确定性段：套词与否定翻转已改。
    expect(json.result.text).not.toContain("不禁");
    expect(json.result.edits.length).toBeGreaterThan(0);
    // 语义段：情绪告知只标注，正文原样保留。
    expect(json.result.text).toContain("感到紧张");
    expect(json.result.manualFlags.some((flag: { rule: string }) => flag.rule === "emotion-telling")).toBe(true);
  });

  it("每条语义标注都带可直接交给叙述者的指示", async () => {
    const { json } = await postDeslop({ text: "他感到紧张。之所以这样是因为门外有人。" });

    expect(json.result.manualFlags.length).toBeGreaterThan(0);
    for (const flag of json.result.manualFlags) {
      expect(typeof flag.instruction).toBe("string");
      expect(flag.instruction.length).toBeGreaterThan(0);
    }
  });

  it("空正文返回 400，不返回空结果假装成功", async () => {
    const { status } = await postDeslop({ text: "   " });
    expect(status).toBe(400);
  });

  it("缺少 text 字段返回 400", async () => {
    const { status } = await postDeslop({});
    expect(status).toBe(400);
  });

  it("尊重白名单：命中词不被改写", async () => {
    const withoutWhitelist = await postDeslop({
      text: "缓缓抬手，缓缓转身，缓缓皱眉，缓缓开口，缓缓坐下。",
    });
    const withWhitelist = await postDeslop({
      text: "缓缓抬手，缓缓转身，缓缓皱眉，缓缓开口，缓缓坐下。",
      whitelist: ["缓缓"],
    });

    expect(withoutWhitelist.json.result.edits.length).toBeGreaterThan(0);
    expect(withWhitelist.json.result.edits).toHaveLength(0);
  });

  it("干净正文返回原文且无改动", async () => {
    const source = "韩立把药锄扛在肩上，鞋底沾着泥。老仆问他要不要添饭，他摇头。";
    const { json } = await postDeslop({ text: source });

    expect(json.result.text).toBe(source);
    expect(json.result.edits).toHaveLength(0);
  });

  it("返回统计口径，便于前端显示改了几处", async () => {
    const { json } = await postDeslop({ text: "他不禁抬起头。他感到紧张。" });

    expect(json.result.stats.autoEditCount).toBe(json.result.edits.length);
    expect(json.result.stats.manualFlagCount).toBe(json.result.manualFlags.length);
    expect(json.result.stats.originalLength).toBeGreaterThan(0);
  });
});
