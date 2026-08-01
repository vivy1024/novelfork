import { describe, expect, it } from "vitest";

import { NOVEL_SESSION_TOOL_DEFINITIONS } from "./tool-registry";

function tool(name: string) {
  return NOVEL_SESSION_TOOL_DEFINITIONS.find((definition) => definition.name === name);
}

describe("novel tool registry lore/memory boundary", () => {
  it("registers lore tools as static setting tools and keeps jingwei as compatibility aliases", () => {
    expect(tool("lore.read")?.description).toContain("静态设定");
    expect(tool("lore.write")?.description).toContain("静态设定");

    expect(tool("jingwei.read")?.description).toContain("兼容别名");
    expect(tool("jingwei.read")?.description).toContain("memory.read");
    expect(tool("jingwei.write")?.description).toContain("兼容别名");
    expect(tool("jingwei.write")?.description).toContain("动态事实不得直接写入 Lore");
    expect(tool("jingwei.read")?.visibility).toBe("advanced");
    expect(tool("jingwei.write")?.visibility).toBe("advanced");
  });

  it("registers memory tools for dynamic retrieval, graph, pending events, and admin operations", () => {
    expect(tool("memory.read")?.description).toContain("动态叙事记忆");
    expect(tool("memory.graph")?.description).toContain("关系图");
    expect(tool("memory.events")?.description).toContain("Pending NarrativeEvents");
    expect(tool("memory.read")?.visibility).toBe("author");
    expect(tool("memory.graph")?.visibility).toBe("author");
    expect(tool("memory.events")?.visibility).toBe("author");

    for (const name of ["memory.list", "memory.read_entry", "memory.search", "memory.dedup", "memory.export", "memory.stats"]) {
      expect(tool(name)?.description).toContain("管理层");
      expect(tool(name)?.risk).toBe("read");
      expect(tool(name)?.visibility).toBe("advanced");
    }
    for (const name of ["memory.update", "memory.delete", "memory.bulk_approve", "memory.bulk_delete"]) {
      expect(tool(name)?.description).toContain("管理层");
      expect(tool(name)?.risk).toBe("confirmed-write");
      expect(tool(name)?.visibility).toBe("advanced");
    }
  });

  it("registers jingwei.audit as a read-only lore audit gate", () => {
    expect(tool("jingwei.audit")?.description).toContain("审计门禁");
    expect(tool("jingwei.audit")?.description).toContain("active + confirmed + participates_in_ai");
    expect(tool("jingwei.audit")?.risk).toBe("read");
    expect(tool("jingwei.audit")?.visibility).toBe("advanced");
  });

  it("does not advertise candidates as cockpit snapshot core output", () => {
    const description = tool("cockpit.snapshot")?.description ?? "";

    expect(description).not.toContain("候选稿");
    expect(description).not.toContain("candidates");
    expect(description).toContain("正式章节");
  });

  it("updates scene spec workflow to use lore/jingwei static settings and memory dynamic recall", () => {
    const description = tool("scene.spec")?.description ?? "";
    expect(description).toContain("write.preflight");
    expect(description).toContain("lore.read");
    expect(description).toContain("memory.read");
    expect(description).toContain("章后结算");
  });

  it("registers write context gate and settlement/discard tools", () => {
    expect(tool("write.preflight")?.risk).toBe("read");
    expect(tool("memory.settle_range")?.risk).toBe("confirmed-write");
    expect(tool("chapter.discard_range")?.risk).toBe("destructive");
    expect(tool("pipeline.write")?.description).toContain("context-not-ready");
  });

  it("registers import closed-loop and book.dissect tools", () => {
    const dissect = tool("book.dissect")?.description ?? "";
    expect(dissect).toContain("续写知识包");
    // 拆书产物必须写经纬 dynamic/needs-review，不能进 canon
    expect(dissect).toContain("needs-review");
    expect(dissect).toContain("权威源");
    expect(tool("pipeline.import_chapters")?.description).toContain("autoSettle");
    expect(tool("style.import")?.description).toContain("saveAsWritingSkill");
  });

  it("registers volume outline, character arc and publish check tools", () => {
    expect(tool("outline.volume")?.description).toContain("卷");
    expect(tool("outline.volume")?.risk).toBe("confirmed-write");
    expect(tool("arc.character")?.description).toContain("弧线");
    expect(tool("arc.character")?.risk).toBe("confirmed-write");
    expect(tool("publish.check")?.description).toContain("敏感词");
    expect(tool("publish.check")?.risk).toBe("read");
  });
});
