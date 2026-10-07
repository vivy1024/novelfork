import { describe, expect, it } from "vitest";
import {
  NARRATIVE_LENSES,
  PANEL_CLASSIFICATIONS,
  RETIRED_DUPLICATE_ENTRIES,
  getLensForPanel,
  getPanelsForLens,
  isPanelInLens,
  type NarrativeLensId,
} from "./narrative-lenses";

describe("narrative-lenses 4 大叙事镜头与面板归属", () => {
  it("4 大主镜头定义完备且有明确核心问题与职责说明", () => {
    const primaryLenses = NARRATIVE_LENSES.filter((l) => l.isPrimary);
    expect(primaryLenses).toHaveLength(4);

    const ids = primaryLenses.map((l) => l.id);
    expect(ids).toContain("write");
    expect(ids).toContain("lore");
    expect(ids).toContain("progression");
    expect(ids).toContain("audit");

    for (const lens of NARRATIVE_LENSES) {
      expect(lens.label.trim().length).toBeGreaterThan(0);
      expect(lens.question.trim().length).toBeGreaterThan(0);
      expect(lens.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("面板全部明确归入镜头，且无未归类面板", () => {
    // 面板清单（下线废弃画布、删除从未挂载的组件与伏笔看板 / 进度账本后保持核心精炼）
    expect(PANEL_CLASSIFICATIONS.length).toBeGreaterThanOrEqual(46);

    const names = new Set<string>();
    for (const item of PANEL_CLASSIFICATIONS) {
      expect(names.has(item.panel)).toBe(false); // 面板名称唯一
      names.add(item.panel);

      expect(["write", "lore", "progression", "audit", "system"]).toContain(item.lens);
      expect(item.role.trim().length).toBeGreaterThan(0);

      // 解释严格遵循三段式结构（发生了什么 / 为什么要看 / 建议怎么做）
      expect(item.explanation.what.trim().length).toBeGreaterThan(0);
      expect(item.explanation.why.trim().length).toBeGreaterThan(0);
      expect(item.explanation.action.trim().length).toBeGreaterThan(0);
    }
  });

  it("四大主镜头各自拥有对应业务面板", () => {
    const writePanels = getPanelsForLens("write");
    const lorePanels = getPanelsForLens("lore");
    const progressionPanels = getPanelsForLens("progression");
    const auditPanels = getPanelsForLens("audit");

    // 写：ChapterEditor, WriteViewPanel 等
    expect(writePanels.some((p) => p.panel === "ChapterEditor")).toBe(true);
    expect(writePanels.some((p) => p.panel === "WriteViewPanel")).toBe(true);

    // 理：JingweiCanonPanel, CanonicalTreesPanel, CharacterCardPage 等
    expect(lorePanels.some((p) => p.panel === "JingweiCanonPanel")).toBe(true);
    expect(lorePanels.some((p) => p.panel === "CanonicalTreesPanel")).toBe(true);

    // 推：StoryProgressBoard, TensionCurvePanel 等（伏笔看板已删，伏笔只在故事画布「下一章」的伏笔账本）
    expect(progressionPanels.some((p) => p.panel === "StoryProgressBoard")).toBe(true);
    expect(progressionPanels.some((p) => p.panel === "TensionCurvePanel")).toBe(true);

    // 审：CompliancePanel, NarrativeConsistencyPanel 等
    expect(auditPanels.some((p) => p.panel === "NarrativeConsistencyPanel")).toBe(true);
    expect(auditPanels.some((p) => p.panel === "CompliancePanel")).toBe(true);
  });

  it("已下线重复入口清单明确，杜绝旧入口混淆", () => {
    expect(RETIRED_DUPLICATE_ENTRIES.length).toBeGreaterThanOrEqual(5);

    const retiredNames = RETIRED_DUPLICATE_ENTRIES.map((r) => r.name);
    // 顶层重复 Tab 已记录下线
    expect(retiredNames).toContain("StoryProgressionCanvas.timeline");
    expect(retiredNames).toContain("StoryProgressionCanvas.chronicle");
    expect(retiredNames).toContain("StoryProgressionCanvas.network");
    expect(retiredNames).toContain("NarrativeMemoryGraphWorkspace");
    expect(retiredNames).toContain("StoryTreePanel");
    // 故事推进减法：伏笔看板、侧栏进度账本与故事画布子页签、画布「执行」视图已下线
    expect(retiredNames).toContain("ForeshadowingBoard（伏笔看板）");
    expect(retiredNames).toContain("StorylineAndPlanningSidebarPanel.foreshadowing（进度账本）");
    expect(retiredNames).toContain("StorylineAndPlanningSidebarPanel.canvas（故事画布子页签）");
    expect(retiredNames).toContain("StoryProgressionCanvas.workflow（执行）");

    for (const entry of RETIRED_DUPLICATE_ENTRIES) {
      expect(entry.replacement.trim().length).toBeGreaterThan(0);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("已删除的组件不再登记在面板清单里", () => {
    const names = PANEL_CLASSIFICATIONS.map((item) => item.panel);
    for (const removed of ["ImportWizard", "AiTasteReport", "CheckpointPanel", "ComplianceViolationCard", "ForeshadowingBoard", "LedgerProgressTable"]) {
      expect(names).not.toContain(removed);
    }
  });

  it("辅助查找函数准确可靠", () => {
    expect(getLensForPanel("ChapterEditor")).toBe("write");
    expect(getLensForPanel("CanonicalTreesPanel")).toBe("lore");
    expect(getLensForPanel("StoryProgressBoard")).toBe("progression");
    expect(getLensForPanel("CompliancePanel")).toBe("audit");
    // 工作流执行面板随入口迁到写作视图
    expect(getLensForPanel("WorkflowTimelinePanel")).toBe("write");
    expect(getLensForPanel("ResourceHistoryPanel")).toBe("system");

    expect(isPanelInLens("ChapterEditor", "write")).toBe(true);
    expect(isPanelInLens("ChapterEditor", "audit")).toBe(false);
  });
});
