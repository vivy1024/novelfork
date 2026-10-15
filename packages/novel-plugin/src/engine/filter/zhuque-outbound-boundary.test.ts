/**
 * 朱雀外发边界守卫（T-10）：正文只能由用户手动扫描路由发往外部检测服务。
 * 写章管线不得引用过滤引擎或朱雀配置；未来若有人在写章里接入，此测试会失败。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PIPELINE_FILE = join(process.cwd(), "src/handlers/pipeline-write-service.ts");

describe("Zhuque outbound boundary (T-10)", () => {
  it("the automatic write pipeline never references the filter engine or Zhuque config", async () => {
    const source = await readFile(PIPELINE_FILE, "utf8");

    expect(source).not.toMatch(/scanChapterAndStoreFilterReport/);
    expect(source).not.toMatch(/\brunFilter\s*\(/);
    expect(source).not.toMatch(/zhuqueConfig|scanWithZhuque|getZhuqueConfigFromKv/);
  });
});
