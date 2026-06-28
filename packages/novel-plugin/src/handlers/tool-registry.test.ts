import { describe, expect, it } from "vitest";

import { NOVEL_SESSION_TOOL_DEFINITIONS } from "./tool-registry";

function tool(name: string) {
  return NOVEL_SESSION_TOOL_DEFINITIONS.find((definition) => definition.name === name);
}

describe("novel tool registry lore/memory boundary", () => {
  it("registers lore tools as static setting tools and keeps jingwei aliases deprecated", () => {
    expect(tool("lore.read")?.description).toContain("静态设定");
    expect(tool("lore.write")?.description).toContain("静态设定");

    expect(tool("jingwei.read")?.description).toContain("deprecated alias");
    expect(tool("jingwei.read")?.description).toContain("动态叙事记忆请使用 memory.read");
    expect(tool("jingwei.write")?.description).toContain("deprecated alias");
    expect(tool("jingwei.write")?.description).toContain("动态事实不得直接写入 Lore");
  });

  it("registers memory tools for dynamic retrieval, graph, pending events, and admin operations", () => {
    expect(tool("memory.read")?.description).toContain("动态叙事记忆");
    expect(tool("memory.graph")?.description).toContain("关系图");
    expect(tool("memory.events")?.description).toContain("Pending NarrativeEvents");

    for (const name of ["memory.list", "memory.read_entry", "memory.search", "memory.dedup", "memory.export", "memory.stats"]) {
      expect(tool(name)?.description).toContain("管理层");
      expect(tool(name)?.risk).toBe("read");
    }
    for (const name of ["memory.update", "memory.delete", "memory.bulk_approve", "memory.bulk_delete"]) {
      expect(tool(name)?.description).toContain("管理层");
      expect(tool(name)?.risk).toBe("confirmed-write");
    }
  });

  it("registers jingwei.audit as a read-only lore audit gate", () => {
    expect(tool("jingwei.audit")?.description).toContain("审计门禁");
    expect(tool("jingwei.audit")?.description).toContain("active + confirmed + participates_in_ai");
    expect(tool("jingwei.audit")?.risk).toBe("read");
  });

  it("does not advertise candidates as cockpit snapshot core output", () => {
    const description = tool("cockpit.snapshot")?.description ?? "";

    expect(description).not.toContain("候选稿");
    expect(description).not.toContain("candidates");
    expect(description).toContain("正式章节");
  });

  it("updates scene spec workflow to use lore and memory instead of jingwei.read", () => {
    const description = tool("scene.spec")?.description ?? "";
    expect(description).toContain("lore.read");
    expect(description).toContain("memory.read");
    expect(description).not.toContain("jingwei.read(scope=brief)");
  });
});
