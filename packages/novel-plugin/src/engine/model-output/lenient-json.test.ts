import { describe, expect, it } from "vitest";

import { parseModelJson } from "./lenient-json.js";

describe("模型 JSON 宽容解析", () => {
  it("合规 JSON 原样解析，不标记修补", () => {
    const result = parseModelJson('{"events":[{"subject":"阿Q","object":"小D"}]}');
    expect(result).toEqual({ ok: true, repaired: false, value: { events: [{ subject: "阿Q", object: "小D" }] } });
  });

  it("去掉代码围栏与前后说明文字", () => {
    const result = parseModelJson('好的，结果如下：\n```json\n{"a":1}\n```\n以上。');
    expect(result).toMatchObject({ ok: true, value: { a: 1 } });
  });

  it("字符串里未转义的 ASCII 引号还原成中文引号（W0 实测：“” 被输出成 \"）", () => {
    const raw = '{"evidence":"这足见我不是一个"立言"的人","transferable":true}';
    const result = parseModelJson(raw);
    expect(result).toMatchObject({ ok: true, repaired: true, value: { evidence: "这足见我不是一个“立言”的人", transferable: true } });
  });

  it("同一字符串里多对引号依次开合", () => {
    const result = parseModelJson('{"t":"他说"先前阔"，又说"真能做"。"}');
    expect(result).toMatchObject({ ok: true, value: { t: "他说“先前阔”，又说“真能做”。" } });
  });

  it("字符串里的裸换行转义，多余逗号去掉", () => {
    const result = parseModelJson('{"text":"第一行\n第二行","list":[1,2,],}');
    expect(result).toMatchObject({ ok: true, value: { text: "第一行\n第二行", list: [1, 2] } });
  });

  it("括号没有闭合判为截断，不猜内容", () => {
    const result = parseModelJson('{"events":[{"subject":"阿Q","object":"小');
    expect(result).toMatchObject({ ok: false, reason: "truncated" });
  });

  it("没有 JSON：宿主报截断时判为截断，否则判为没有 JSON", () => {
    expect(parseModelJson("我先想一想……")).toMatchObject({ ok: false, reason: "no-json" });
    expect(parseModelJson("我先想一想……", { outputTruncated: true })).toMatchObject({ ok: false, reason: "truncated" });
  });

  it("按期望只取数组", () => {
    const result = parseModelJson('说明 {不是这个} 结果：[{"a":1}]', { expect: "array" });
    expect(result).toMatchObject({ ok: true, value: [{ a: 1 }] });
  });

  it("修补后仍无法解析，返回 invalid", () => {
    const result = parseModelJson('{"a": 1 2}');
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });
});
