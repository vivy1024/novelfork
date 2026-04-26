import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetForTesting,
  getBundle,
  getPreset,
  getPresetsByGenre,
  listBundles,
  listLogicRisks,
  listPresets,
  listSettingBases,
  registerPreset,
} from "../presets/index.js";
import type { LogicRiskRule, PresetBundle, SettingBasePreset } from "../presets/types.js";

describe("preset registry", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("registers and retrieves presets", () => {
    registerPreset({
      id: "tone-tragic-solitude",
      name: "悲苦孤独",
      category: "tone",
      description: "适用于凡人流仙侠、悲情仙侠。",
      promptInjection: "保持悲苦、克制、孤独感。",
      compatibleGenres: ["xianxia"],
    });

    expect(getPreset("tone-tragic-solitude")?.name).toBe("悲苦孤独");
  });

  it("filters by category", () => {
    registerPreset({ id: "a", name: "A", category: "tone", description: "A", promptInjection: "A" });
    registerPreset({ id: "b", name: "B", category: "literary", description: "B", promptInjection: "B" });

    expect(listPresets("tone")).toHaveLength(1);
    expect(listPresets("tone")[0]!.id).toBe("a");
  });

  it("filters by compatible genre and includes universal presets", () => {
    registerPreset({ id: "a", name: "A", category: "tone", description: "A", promptInjection: "A", compatibleGenres: ["xianxia"] });
    registerPreset({ id: "b", name: "B", category: "literary", description: "B", promptInjection: "B" });

    const result = getPresetsByGenre("urban");

    expect(result.map((p) => p.id)).toEqual(["b"]);
  });

  it("lists setting bases, logic risks, and bundles", () => {
    const setting: SettingBasePreset = {
      id: "victorian-industrial-occult",
      name: "维多利亚工业神秘",
      category: "setting-base",
      description: "工业城市神秘学基底。",
      promptInjection: "使用工业城市基底。",
      referenceAnchors: ["维多利亚时代城市化"],
      socialHierarchy: ["贵族", "工人"],
      powerInstitutions: ["警察", "教会"],
      economy: ["工资", "房租"],
      techMagicBoundary: ["蒸汽机械", "神秘学代价"],
      transportAndInformation: ["报纸", "电报"],
      dailyLifeMaterials: ["煤气灯"],
      borrowableElements: ["报业"],
      forbiddenElements: ["现代移动支付"],
      commonContradictions: ["信息传播过快"],
    };
    const risk: LogicRiskRule = {
      id: "information-flow",
      name: "信息传播速度",
      category: "logic-risk",
      description: "检查信息速度。",
      promptInjection: "限制信息传播。",
      riskType: "information-flow",
      appliesToSettingBases: ["victorian-industrial-occult"],
      writerConstraint: "说明信息来源。",
      auditQuestion: "是否信息过快？",
      evidenceHints: ["远方消息即时抵达"],
      uncertainHandling: "要求作者确认。",
    };
    const bundle: PresetBundle = {
      id: "industrial-occult-mystery",
      name: "工业神秘悬疑",
      category: "bundle",
      description: "组合。",
      promptInjection: "组合注入。",
      genreIds: ["mystery"],
      toneId: "austere-pragmatic",
      settingBaseId: "victorian-industrial-occult",
      logicRiskIds: ["information-flow"],
      difficulty: "hard",
      prerequisites: ["需要制度边界"],
      suitableFor: ["工业悬疑"],
      notSuitableFor: ["纯轻松日常"],
    };

    registerPreset(setting);
    registerPreset(risk);
    registerPreset(bundle);

    expect(listSettingBases()).toHaveLength(1);
    expect(listLogicRisks()).toHaveLength(1);
    expect(listBundles()).toHaveLength(1);
    expect(getBundle("industrial-occult-mystery")?.difficulty).toBe("hard");
    expect(getPreset("industrial-occult-mystery")?.conflictGroup).toBeUndefined();
  });

  it("registers anti-ai and literary presets and filters by category", () => {
    registerPreset({ id: "anti-ai-full-scan", name: "12 特征全量扫描", category: "anti-ai", description: "desc", promptInjection: "inject" });
    registerPreset({ id: "anti-ai-sentence-variance", name: "句长方差修复", category: "anti-ai", description: "desc", promptInjection: "inject" });
    registerPreset({ id: "literary-character-multidim", name: "人物多维度展开", category: "literary", description: "desc", promptInjection: "inject" });
    registerPreset({ id: "literary-hook-four-states", name: "伏笔四态追踪", category: "literary", description: "desc", promptInjection: "inject" });

    expect(listPresets("anti-ai")).toHaveLength(2);
    expect(listPresets("literary")).toHaveLength(2);
    expect(getPreset("anti-ai-full-scan")?.category).toBe("anti-ai");
    expect(getPreset("literary-hook-four-states")?.category).toBe("literary");
  });
});
