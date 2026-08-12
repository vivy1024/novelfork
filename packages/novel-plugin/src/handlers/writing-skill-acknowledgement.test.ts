import { describe, expect, it } from "vitest";

import {
  describeWritingSkillAcknowledgementRequirement,
  explainWritingSkillAcknowledgementVerdict,
  selectRelevantWritingSkills,
  verifyWritingSkillAcknowledgements,
  type AcknowledgeableWritingSkill,
} from "./writing-skill-acknowledgement.js";

const SKILLS: AcknowledgeableWritingSkill[] = [
  { slug: "austere", name: "克制写实", description: "动作细节", mode: "always" },
  { slug: "hook", name: "章末钩子", tags: ["钩子"] },
];

describe("Runtime Skill evidence", () => {
  it("不再要求原文引用长度", () => {
    const required = describeWritingSkillAcknowledgementRequirement([
      ...SKILLS,
      { slug: "tiny", name: "短技能", body: "短" },
    ]);
    expect(required.map((item) => item.slug)).toEqual(["austere", "hook", "tiny"]);
    expect(required.every((item) => item.minQuoteChars === 0)).toBe(true);
  });

  it("只把当前任务相关技能纳入证据检查", () => {
    const relevant = selectRelevantWritingSkills(SKILLS, "本章需要处理钩子");
    expect(relevant.map((skill) => skill.slug)).toEqual(["austere", "hook"]);
  });

  it("同一 Runtime narrator 成功加载相关技能时通过", () => {
    const verdict = verifyWritingSkillAcknowledgements({
      skills: SKILLS,
      taskText: "本章需要处理钩子",
      loadedSkills: [{ name: "章末钩子", loadedAt: "2026-08-10T00:00:00.000Z" }, { name: "克制写实", loadedAt: "2026-08-10T00:00:01.000Z" }],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.loaded).toEqual(["austere", "hook"]);
  });

  it("未加载相关技能时只报告 missing，不接受模型伪造引用", () => {
    const verdict = verifyWritingSkillAcknowledgements({
      skills: SKILLS,
      acknowledged: [{ slug: "austere", quote: "任意伪造文本" }],
      loadedSkills: [],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(["austere", "hook"]);
    expect(verdict.tooShort).toEqual([]);
    expect(verdict.notFound).toEqual([]);
  });

  it("未启用技能时通过", () => {
    expect(verifyWritingSkillAcknowledgements({ skills: [], loadedSkills: [] }).ok).toBe(true);
  });
});

describe("explainWritingSkillAcknowledgementVerdict", () => {
  it("说明 Runtime Agent 需要先加载技能", () => {
    const verdict = verifyWritingSkillAcknowledgements({ skills: SKILLS, loadedSkills: [] });
    const explanation = explainWritingSkillAcknowledgementVerdict({ verdict, skills: SKILLS });
    expect(explanation.whatHappened).toContain("克制写实");
    expect(explanation.whyItMatters).toContain("同一 narrator");
    expect(explanation.suggestedAction).toContain("Skill");
  });
});
